import { isDeepStrictEqual } from "node:util";
import { Query } from "@distilled.cloud/core/query";
import {
  Linear,
  type Webhook as LinearWebhook,
  type WebhookCreateInput,
  type WebhookUpdateInput,
} from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { changes, ignoreNotFound, isEmpty } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface WebhookProps {
  /**
   * HTTPS endpoint Linear delivers events to.
   */
  url: string;

  /**
   * Entity types whose events the webhook receives, such as `Issue`,
   * `Comment`, `Project` or `IssueLabel`.
   */
  resourceTypes: string[];

  /**
   * Linear ID of the team whose events the webhook receives. Unset subscribes
   * it to every public team. Changing it replaces the webhook.
   */
  teamId?: string;

  /**
   * Label shown for the webhook in Linear's settings. Unset leaves the
   * current label alone.
   */
  label?: string;

  /**
   * Whether Linear delivers events to the webhook. Unset leaves the current
   * setting alone.
   */
  enabled?: boolean;

  /**
   * Secret Linear signs each delivery with, in the `Linear-Signature`
   * header. Unset keeps the secret Linear generated.
   */
  secret?: Redacted.Redacted<string>;
}

export interface WebhookAttributes {
  /**
   * Linear ID of the webhook.
   */
  webhookId: string;

  /**
   * HTTPS endpoint Linear delivers events to.
   */
  url: string;

  /**
   * Secret Linear signs each delivery with.
   */
  secret: Redacted.Redacted<string> | undefined;
}

export interface Webhook extends Resource<
  "Linear.Webhook",
  WebhookProps,
  WebhookAttributes,
  never,
  Providers
> {}

/**
 * A Linear webhook that delivers workspace events to an HTTPS endpoint.
 *
 * Webhooks are matched by URL and team. One that already exists for the same
 * URL and team is never taken over silently: deploy it with `adopt(true)` to
 * manage it.
 *
 * ### Creating a Webhook
 * **Example:** Team Webhook with a Signing Secret
 * ```typescript
 * import * as Config from "effect/Config";
 *
 * const hook = yield* Linear.Webhook("issues", {
 *   url: "https://example.com/linear",
 *   resourceTypes: ["Issue", "Comment"],
 *   teamId: team.teamId,
 *   label: "Issue sync",
 *   secret: yield* Config.redacted("LINEAR_WEBHOOK_SECRET"),
 * });
 * ```
 *
 * **Example:** Webhook on Every Public Team
 * ```typescript
 * yield* Linear.Webhook("projects", {
 *   url: "https://example.com/linear/projects",
 *   resourceTypes: ["Project"],
 * });
 * ```
 *
 * ### Verifying Deliveries
 * Leaving `secret` unset keeps the secret Linear generates, and the `secret`
 * attribute exposes it for checking the `Linear-Signature` header.
 *
 * **Example:** Export the Generated Signing Secret
 * ```typescript
 * const hook = yield* Linear.Webhook("issues", {
 *   url: "https://example.com/linear",
 *   resourceTypes: ["Issue"],
 * });
 *
 * return { secret: hook.secret };
 * ```
 *
 * @resource
 * @product Linear
 */
export const Webhook = Resource<Webhook>("Linear.Webhook");

const fields = (webhook: Query<LinearWebhook>) => ({
  id: webhook.id,
  url: webhook.url,
  label: webhook.label,
  enabled: webhook.enabled,
  secret: webhook.secret,
  resourceTypes: webhook.resourceTypes,
  teamId: webhook.team.id,
});

const webhooks = () =>
  Stream.runCollect(Query.items(Linear.webhooks({ first: 100 }).pipe(Query.map(fields))));
const create = Query.fn((input: WebhookCreateInput) =>
  Linear.webhookCreate({ input }).webhook.pipe(Query.map(fields)),
);
const update = Query.fn(
  (id: string, input: WebhookUpdateInput) => Linear.webhookUpdate({ id, input }).success,
);
const remove = Query.fn((id: string) => Linear.webhookDelete({ id }).success);

const observe = Effect.fn("observe")(function* (
  props: WebhookProps,
  webhookId: string | undefined,
) {
  const all = yield* webhooks();
  return (
    all.find((webhook) => webhook.id === webhookId) ??
    all.find(
      (webhook) => webhook.url === props.url && (webhook.teamId ?? undefined) === props.teamId,
    )
  );
});

const redact = (value: string | null | undefined) =>
  value === null || value === undefined ? undefined : Redacted.make(value);

export const WebhookProvider = () =>
  Provider.succeed(Webhook, {
    stables: ["webhookId"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && news.teamId !== olds.teamId
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds, output }) =>
      observe(olds, output?.webhookId).pipe(
        Effect.map(
          (webhook) =>
            webhook &&
            Unowned({
              webhookId: webhook.id,
              url: webhook.url ?? olds.url,
              secret: redact(webhook.secret),
            }),
        ),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      const secret = news.secret === undefined ? undefined : Redacted.value(news.secret);
      const webhook =
        (yield* observe(news, output?.webhookId)) ??
        (yield* create({
          url: news.url,
          resourceTypes: news.resourceTypes,
          teamId: news.teamId,
          allPublicTeams: news.teamId === undefined,
          label: news.label,
          enabled: news.enabled,
          secret,
        }));
      const sameTypes = yield* Effect.sync(() =>
        isDeepStrictEqual(webhook.resourceTypes.toSorted(), news.resourceTypes.toSorted()),
      );
      const patch = {
        ...changes<WebhookUpdateInput, "url" | "label" | "enabled" | "secret">(
          webhook,
          { url: news.url, label: news.label, enabled: news.enabled, secret },
          ["url", "label", "enabled", "secret"],
        ),
        ...(sameTypes ? {} : { resourceTypes: news.resourceTypes }),
      };
      if (!isEmpty(patch)) yield* update(webhook.id, patch);
      return { webhookId: webhook.id, url: news.url, secret: redact(secret ?? webhook.secret) };
    }),

    delete: ({ output }) => ignoreNotFound(remove(output.webhookId)),
  });
