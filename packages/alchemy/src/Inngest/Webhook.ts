import * as Inngest from "@distilled.cloud/inngest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";

export interface WebhookEventFilter {
  /** Event names the filter applies to, with `*` wildcards, e.g. `orders/*`. */
  events: string[];
  /**
   * Whether `events` is an allow list or a deny list.
   * @default "ALLOW"
   */
  filter?: "ALLOW" | "DENY";
}

export interface WebhookProps {
  /**
   * Display name of the webhook in the Inngest dashboard. If omitted, a
   * unique name is generated from the app, stage and logical ID.
   */
  name?: string;
  /**
   * JavaScript source of the `transform(evt, headers, queryParams, raw)`
   * function that turns an inbound request into an Inngest event
   * `{ name, data, id?, ts? }`. Read it from a file to keep it testable.
   */
  transform: string;
  /**
   * JavaScript source of an optional `respond(body, headers)` function that
   * answers the provider's verification `GET` request. Changing it triggers
   * a replacement.
   */
  response?: string;
  /**
   * Allow or deny list of event names the webhook accepts. Changing it
   * triggers a replacement.
   */
  eventFilter?: WebhookEventFilter;
}

export interface WebhookAttributes {
  /** Webhook id. */
  id: string;
  /** Display name. */
  name: string;
  /** Inbound URL to register with the provider, `https://inn.gs/e/...`. */
  url: string;
  /** JavaScript source of the transform function Inngest runs. */
  transform: string;
}

export type Webhook = Resource<
  "Inngest.Webhook",
  WebhookProps,
  WebhookAttributes,
  never,
  Providers
>;

export class WebhookReplacementRequired extends Data.TaggedError(
  "Inngest.WebhookReplacementRequired",
)<{
  id: string;
  name: string;
}> {
  override get message() {
    return `Inngest webhook '${this.name}' (${this.id}) cannot be updated in place: the update API only accepts name and transform and clears response and eventFilter. Replace it, or drop response and eventFilter.`;
  }
}

/**
 * An Inngest webhook: a URL that turns a third-party provider's requests into
 * Inngest events through a JavaScript transform.
 *
 * Webhooks belong to the environment the configured key reaches: a
 * production API key manages production webhooks, and the branch environment
 * signing key manages the webhooks every branch environment shares. Inngest
 * does not verify the provider's signature; the transform receives the raw
 * body and headers so the function it triggers can verify it. Changing
 * `name` or `transform` updates the webhook in place and keeps its URL.
 * Inngest's update API clears `response` and `eventFilter`, so a change to
 * either, or any change to a webhook that sets them, replaces the webhook
 * and issues a new URL.
 * @see https://www.inngest.com/docs/platform/webhooks
 *
 * ### Receiving provider events
 * **Example:** Webhook with a transform read from a file
 * ```typescript
 * const fs = yield* FileSystem.FileSystem;
 *
 * const webhook = yield* Inngest.Webhook("clerk", {
 *   transform: yield* fs.readFileString("./inngest/clerk.transform.js"),
 * });
 *
 * yield* Clerk.Webhook("inngest", { url: webhook.url });
 * ```
 *
 * ### Filtering events
 * **Example:** Only accept order events
 * ```typescript
 * yield* Inngest.Webhook("orders", {
 *   transform: yield* fs.readFileString("./inngest/orders.transform.js"),
 *   eventFilter: { events: ["orders/*"], filter: "ALLOW" },
 * });
 * ```
 *
 * @resource
 * @product Webhooks
 */
export const Webhook = Resource<Webhook>("Inngest.Webhook");

type ObservedFilter = WebhookEventFilter | Inngest.V2EventFilter | undefined;

const normalizeFilter = (filter: ObservedFilter) =>
  filter === undefined
    ? undefined
    : { events: [...(filter.events ?? [])].sort(), filter: filter.filter ?? "ALLOW" };

const sameFilter = (a: ObservedFilter, b: ObservedFilter) =>
  JSON.stringify(normalizeFilter(a)) === JSON.stringify(normalizeFilter(b));

const setsExtras = (props: WebhookProps) =>
  props.response !== undefined || props.eventFilter !== undefined;

export const WebhookProvider = () =>
  Provider.effect(
    Webhook,
    Effect.gen(function* () {
      const createWebhook = yield* Inngest.createV2Webhook;
      const listWebhooks = yield* Inngest.listV2Webhooks;
      const updateWebhook = yield* Inngest.v1.updateWebhook;
      const deleteWebhook = yield* Inngest.v1.deleteWebhook;

      const resolveName = (id: string, props: WebhookProps | undefined) =>
        props?.name ? Effect.succeed(props.name) : createPhysicalName({ id });

      const find = (predicate: (webhook: Inngest.V2Webhook) => boolean) =>
        listWebhooks
          .items({})
          .pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrUndefined));

      const toAttributes = (webhook: Inngest.V2Webhook): WebhookAttributes => ({
        id: webhook.id!,
        name: webhook.name!,
        url: webhook.url!,
        transform: webhook.transform!,
      });

      return {
        stables: ["id", "url"],
        diff: Effect.fn(function* ({ id, news, olds, output }) {
          if (!isResolved(news) || output === undefined) return undefined;
          const name = yield* resolveName(id, news);
          const extrasChanged =
            news.response !== olds.response || !sameFilter(news.eventFilter, olds.eventFilter);
          const coreChanged = name !== output.name || news.transform !== output.transform;
          if (extrasChanged || (coreChanged && setsExtras(news))) {
            return { action: "replace" } as const;
          }
          return undefined;
        }),
        reconcile: Effect.fn(function* ({ id, news, output }) {
          const name = yield* resolveName(id, news);
          const observed =
            output === undefined ? undefined : yield* find((webhook) => webhook.id === output.id);
          if (observed === undefined) {
            const created = yield* createWebhook({
              name,
              transform: news.transform,
              response: news.response,
              eventFilter: news.eventFilter,
            });
            return toAttributes(created.data!);
          }
          const coreChanged = observed.name !== name || observed.transform !== news.transform;
          const extrasChanged =
            (observed.response ?? undefined) !== news.response ||
            !sameFilter(observed.eventFilter, news.eventFilter);
          if (!coreChanged && !extrasChanged) {
            return toAttributes(observed);
          }
          if (setsExtras(news)) {
            return yield* new WebhookReplacementRequired({ id: observed.id!, name });
          }
          const updated = yield* updateWebhook({
            id: observed.id!,
            name,
            transform: news.transform,
          });
          return {
            id: updated.data.id,
            name: updated.data.name,
            url: updated.data.url,
            transform: updated.data.transform,
          };
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* deleteWebhook({ id: output.id }).pipe(
            Effect.catchTag("WebhookNotFound", () => Effect.void),
          );
        }),
        read: Effect.fn(function* ({ id, olds, output }) {
          if (output !== undefined) {
            const observed = yield* find((webhook) => webhook.id === output.id);
            return observed === undefined ? undefined : toAttributes(observed);
          }
          const name = yield* resolveName(id, olds);
          const observed = yield* find((webhook) => webhook.name === name);
          return observed === undefined ? undefined : Unowned(toAttributes(observed));
        }),
      };
    }),
  );
