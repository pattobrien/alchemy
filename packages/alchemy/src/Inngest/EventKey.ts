import * as Inngest from "@distilled.cloud/inngest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";

export interface EventKeyProps {
  /**
   * Name of the event key in the Inngest dashboard, e.g. `Default ingest key`.
   * If omitted, the environment's first event key is used.
   */
  name?: string;
  /**
   * Environment to read the key from. Defaults to the environment the
   * configured API key belongs to: `production` for a production key,
   * `branch` for the branch environment signing key.
   */
  environment?: string;
}

export interface EventKeyAttributes {
  /** Event key id. */
  id: string;
  /** Name of the event key. */
  name: string;
  /** Environment the key sends events to. */
  environment: string;
  /** The event key, for the client's `INNGEST_EVENT_KEY`. */
  key: Redacted.Redacted<string>;
}

export type EventKey = Resource<
  "Inngest.EventKey",
  EventKeyProps,
  EventKeyAttributes,
  never,
  Providers
>;

export class EventKeyNotFound extends Data.TaggedError("Inngest.EventKeyNotFound")<{
  name: string | undefined;
  environment: string | undefined;
}> {
  override get message() {
    return `Inngest has no event key${this.name === undefined ? "" : ` named '${this.name}'`} in ${this.environment === undefined ? "the configured key's environment" : `environment '${this.environment}'`}`;
  }
}

/**
 * A read-only handle to an Inngest event key, so a host can bind
 * `INNGEST_EVENT_KEY` from the stack instead of a copied secret.
 *
 * Inngest creates event keys per environment and all branch environments
 * share the `branch` parent's keys. Deployment reads the key through the
 * configured API key and records it in state; it does not create or rotate
 * keys, and destroying the resource leaves the key in place.
 * @see https://www.inngest.com/docs/events/creating-an-event-key
 *
 * ### Sending events from a Worker
 * **Example:** Bind the branch event key into a Worker
 * ```typescript
 * const env = yield* Inngest.BranchEnvironment("preview");
 * const eventKey = yield* Inngest.EventKey("events");
 *
 * const worker = yield* Cloudflare.Worker("api", {
 *   main: "./src/worker.ts",
 *   env: {
 *     INNGEST_ENV: env.name,
 *     INNGEST_EVENT_KEY: eventKey.key,
 *   },
 * });
 * ```
 *
 * @resource
 * @product Keys
 */
export const EventKey = Resource<EventKey>("Inngest.EventKey");

export const EventKeyProvider = () =>
  Provider.effect(
    EventKey,
    Effect.gen(function* () {
      const listKeys = yield* Inngest.fetchV2AccountEventKeys;

      const observe = Effect.fn(function* (
        name: string | undefined,
        environment: string | undefined,
      ) {
        const found = yield* listKeys.items({ xInngestEnv: environment }).pipe(
          Stream.filter((key) => name === undefined || key.name === name),
          Stream.runHead,
          Effect.map(Option.getOrUndefined),
        );
        if (found?.key === undefined) {
          return yield* new EventKeyNotFound({ name, environment });
        }
        return {
          id: found.id!,
          name: found.name!,
          environment: found.environment!,
          key: Redacted.make(found.key),
        };
      });

      return {
        nuke: { skip: true },
        reconcile: Effect.fn(function* ({ news }) {
          return yield* observe(news.name, news.environment);
        }),
        read: Effect.fn(function* ({ olds, output }) {
          return yield* observe(
            output?.name ?? olds.name,
            output?.environment ?? olds.environment,
          ).pipe(Effect.catchTag("Inngest.EventKeyNotFound", () => Effect.succeed(undefined)));
        }),
        delete: () => Effect.void,
      };
    }),
  );
