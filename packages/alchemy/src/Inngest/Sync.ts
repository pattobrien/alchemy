import * as Inngest from "@distilled.cloud/inngest";
import type { Credentials } from "@distilled.cloud/inngest/Credentials";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Action } from "../Action.ts";
import { makeBranchEnvironmentApi } from "./BranchEnvironmentApi.ts";

export interface SyncProps {
  /** Full URL of the app's Inngest serve endpoint, e.g. `https://api.example.com/api/inngest`. */
  url: string;
  /**
   * Any value that changes whenever the app deploys, such as a Worker's
   * `hash`. The sync runs again whenever it changes.
   */
  version?: unknown;
  /**
   * Name of the branch environment the app syncs into, matching its
   * `INNGEST_ENV`. When set, the sync unarchives the environment, checks that
   * the sync created it, and checks that the app is not archived.
   */
  environment?: string;
}

export interface SyncResult {
  /** The serve endpoint that registered with Inngest. */
  url: string;
  /** Whether Inngest saw a change to the app's functions. */
  modified: boolean;
  /** Inngest's id for the branch environment, when `environment` is set. */
  environmentId: string | undefined;
}

export class SyncFailed extends Data.TaggedError("Inngest.SyncFailed")<{
  url: string;
  status: number;
  body: string;
}> {}

export class SyncEnvironmentMissing extends Data.TaggedError("Inngest.SyncEnvironmentMissing")<{
  url: string;
  environment: string;
}> {}

export class SyncAppArchived extends Data.TaggedError("Inngest.SyncAppArchived")<{
  url: string;
  environment: string;
  appId: string | undefined;
  message: string;
}> {}

const RegisterResponse = Schema.Struct({
  message: Schema.String,
  modified: Schema.Boolean,
});

/**
 * Syncs an app with Inngest after it deploys, so Inngest picks up its current
 * functions.
 *
 * The sync sends `PUT` to the app's serve endpoint, which makes the Inngest
 * SDK register the app with the signing key and `INNGEST_ENV` it was deployed
 * with. Inngest only syncs automatically for its Vercel and Netlify
 * integrations; other hosts, such as Cloudflare Workers, need this after each
 * deploy, so pass a `version` that changes with each deploy. Syncing into a
 * branch environment for the first time creates it.
 *
 * Archiving a branch environment also archives its apps, and Inngest has no
 * API to unarchive an app, so a sync into a previously archived environment
 * fails with `Inngest.SyncAppArchived` rather than leaving the app's functions
 * silently inactive.
 * @see https://www.inngest.com/docs/apps/cloud
 *
 * ### Syncing a Worker
 * **Example:** Sync after every Worker deploy
 * ```typescript
 * const worker = yield* Cloudflare.Worker("api", { main: "./src/worker.ts" });
 *
 * yield* Inngest.Sync({
 *   url: Output.interpolate`${worker.url}/api/inngest`,
 *   version: worker.hash,
 * });
 * ```
 */
export const Sync = Action(
  "Inngest.Sync",
  Effect.gen(function* () {
    const services = yield* Effect.context<Credentials | HttpClient.HttpClient>();
    const http = yield* HttpClient.HttpClient;
    const listApps = yield* Inngest.getV2Apps;
    const api = yield* makeBranchEnvironmentApi;

    const register = Effect.fn(
      function* (url: string) {
        const response = yield* http.execute(HttpClientRequest.put(url));
        const body = yield* response.text;
        if (response.status !== 200) {
          return yield* new SyncFailed({ url, status: response.status, body });
        }
        return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RegisterResponse))(body);
      },
      Effect.retry({
        while: (e) => e._tag === "Inngest.SyncFailed" && (e.status === 404 || e.status >= 500),
        schedule: Schedule.spaced("2 seconds"),
        times: 15,
      }),
    );

    const activate = Effect.fn(
      function* (url: string, environment: string) {
        const env = yield* api.setArchived(environment, false);
        if (env?.id === undefined) {
          return yield* new SyncEnvironmentMissing({ url, environment });
        }
        return env.id;
      },
      Effect.retry({
        while: (e) => e._tag === "Inngest.SyncEnvironmentMissing",
        schedule: Schedule.spaced("1 second"),
        times: 5,
      }),
    );

    const ensureAppActive = Effect.fn(function* (url: string, environment: string) {
      const archived = yield* listApps.items({ xInngestEnv: environment, archived: true }).pipe(
        Stream.filter((app) => app.latestSync?.url === url),
        Stream.runHead,
      );
      if (Option.isSome(archived)) {
        return yield* new SyncAppArchived({
          url,
          environment,
          appId: archived.value.id,
          message: `Inngest app '${archived.value.id}' in branch environment '${environment}' is archived. Unarchive it in the Inngest dashboard, or deploy to a new branch environment name.`,
        });
      }
    });

    return Effect.fn(function* (input: SyncProps) {
      const environment = input.environment;
      if (environment !== undefined) {
        yield* api.setArchived(environment, false);
      }
      const registered = yield* register(input.url);
      if (environment === undefined) {
        return {
          url: input.url,
          modified: registered.modified,
          environmentId: undefined,
        } satisfies SyncResult;
      }
      const environmentId = yield* activate(input.url, environment);
      yield* ensureAppActive(input.url, environment);
      return {
        url: input.url,
        modified: registered.modified,
        environmentId,
      } satisfies SyncResult;
    }, Effect.provide(services));
  }),
);
