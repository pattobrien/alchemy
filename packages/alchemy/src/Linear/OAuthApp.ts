import { Query } from "@distilled.cloud/core/query";
import { Linear } from "@distilled.cloud/linear";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { Unowned } from "../AdoptPolicy.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { UserFacingError } from "../UserFacingError.ts";
import { LinearBrowser } from "./Browser.ts";
import { changes, isEmpty } from "./Client.ts";
import type { Providers } from "./Providers.ts";
import {
  createOAuthApp,
  deleteOAuthApp,
  listOAuthApps,
  readOAuthApp,
  updateOAuthApp,
  type LiveOAuthApp,
  type WebhookEventType,
} from "./WebFlows.ts";

export type OAuthAppWebhookResourceType = WebhookEventType;

export interface OAuthAppProps {
  /**
   * Name of the application, shown to users when they authorize it. The
   * application is matched by this name when no ID is known.
   */
  name: string;

  /**
   * Name of the developer shown on the authorization screen.
   */
  developer: string;

  /**
   * URL of the developer shown on the authorization screen. Unset leaves the
   * current URL alone.
   */
  developerUrl?: string;

  /**
   * Description shown on the authorization screen. Unset leaves the current
   * description alone.
   */
  description?: string;

  /**
   * URLs Linear may redirect to after a user authorizes the application.
   */
  redirectUris: string[];

  /**
   * Whether the application accepts the `client_credentials` grant, which
   * mints app-actor tokens without a user. Unset leaves the setting alone.
   */
  clientCredentials?: boolean;

  /**
   * HTTPS endpoint Linear delivers the application's webhook events to.
   * Setting it turns the application's webhook on. Unset leaves the webhook
   * alone.
   */
  webhookUrl?: string;

  /**
   * Entity types whose events the application's webhook receives, such as
   * `AgentSessionEvent`, `Issue` or `Comment`. Unset leaves the current
   * subscriptions alone.
   */
  webhookResourceTypes?: OAuthAppWebhookResourceType[];
}

export interface OAuthAppAttributes {
  /**
   * Linear ID of the application.
   */
  applicationId: string;

  /**
   * OAuth client ID of the application.
   */
  clientId: Redacted.Redacted<string>;

  /**
   * OAuth client secret of the application.
   */
  clientSecret: Redacted.Redacted<string>;

  /**
   * Secret Linear signs the application's webhook deliveries with, in the
   * `Linear-Signature` header. Unset while the webhook is off.
   */
  webhookSecret: Redacted.Redacted<string> | undefined;
}

export interface OAuthApp extends Resource<
  "Linear.OAuthApp",
  OAuthAppProps,
  OAuthAppAttributes,
  never,
  Providers
> {}

/**
 * A Linear OAuth application, managed through Linear's settings UI.
 *
 * Linear offers no API for OAuth applications, so the provider drives the
 * workspace's API settings page in a browser profile signed in to Linear
 * once with `alchemy provider linear browser-login`. Pass `browser` to the
 * providers to enable it. The workspace is the one the providers'
 * credentials belong to. Applications are matched by ID, then by name. One
 * that already exists is never taken over silently: deploy it with
 * `adopt(true)` to manage it. The client secret and webhook signing secret
 * are read from the application's page on every deploy.
 *
 * ### Creating an OAuth Application
 * **Example:** Agent Application with Webhooks
 * ```typescript
 * const app = yield* Linear.OAuthApp("agent", {
 *   name: "My Agent",
 *   developer: "Acme",
 *   redirectUris: ["https://example.com/oauth/callback"],
 *   clientCredentials: true,
 *   webhookUrl: "https://example.com/linear/webhook",
 *   webhookResourceTypes: ["AgentSessionEvent", "Issue"],
 * });
 *
 * return {
 *   clientId: app.clientId,
 *   clientSecret: app.clientSecret,
 *   webhookSecret: app.webhookSecret,
 * };
 * ```
 *
 * ### Enabling the Browser Session
 * **Example:** Providers with a Browser Session
 * ```typescript
 * export default Alchemy.Stack(
 *   "LinearApps",
 *   { providers: Linear.providers({ browser: true }) },
 *   Effect.gen(function* () {
 *     yield* Linear.OAuthApp("agent", {
 *       name: "My Agent",
 *       developer: "Acme",
 *       redirectUris: ["https://example.com/oauth/callback"],
 *     });
 *   }),
 * );
 * ```
 *
 * @resource
 * @product Linear
 */
export const OAuthApp = Resource<OAuthApp>("Linear.OAuthApp");

export class LinearOAuthAppNeedsBrowser extends Data.TaggedError("LinearOAuthAppNeedsBrowser")<{}> {
  readonly [UserFacingError] = true;
  override get message(): string {
    return "Linear has no API for OAuth applications, so Linear.OAuthApp needs a browser session: pass Linear.providers({ browser: true }) and sign in once with `alchemy provider linear browser-login`.";
  }
}

const inBrowser = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const browser = yield* Effect.serviceOption(LinearBrowser);
    if (Option.isNone(browser)) return yield* new LinearOAuthAppNeedsBrowser();
    return yield* Effect.provideService(effect, LinearBrowser, browser.value);
  });

const workspace = Query.fn(() => Linear.organization().urlKey);

const find = Effect.fn("find")(function* (
  slug: string,
  name: string,
  applicationId: string | undefined,
) {
  const byId = applicationId === undefined ? undefined : yield* readOAuthApp(slug, applicationId);
  if (byId !== undefined) return byId;
  const listed = (yield* listOAuthApps(slug)).find((app) => app.name === name);
  return listed === undefined ? undefined : yield* readOAuthApp(slug, listed.id);
});

const sameSet = (live: readonly string[], desired: readonly string[] | undefined) =>
  desired === undefined || live.toSorted().join("\n") === desired.toSorted().join("\n");

const SCALARS = [
  "name",
  "developer",
  "developerUrl",
  "description",
  "clientCredentials",
  "webhookUrl",
] as const;

const drifted = (live: LiveOAuthApp["settings"], desired: OAuthAppProps) =>
  !isEmpty(changes<OAuthAppProps, (typeof SCALARS)[number]>(live, desired, SCALARS)) ||
  !sameSet(live.redirectUris, desired.redirectUris) ||
  !sameSet(live.webhookResourceTypes, desired.webhookResourceTypes);

const attributes = (app: LiveOAuthApp): OAuthAppAttributes => ({
  applicationId: app.id,
  clientId: Redacted.make(app.clientId),
  clientSecret: Redacted.make(app.clientSecret),
  webhookSecret: app.webhookSecret === undefined ? undefined : Redacted.make(app.webhookSecret),
});

export const OAuthAppProvider = () =>
  Provider.succeed(OAuthApp, {
    stables: ["applicationId", "clientId"],

    read: ({ olds, output }) =>
      inBrowser(
        Effect.gen(function* () {
          const app = yield* find(yield* workspace(), olds.name, output?.applicationId);
          return app && Unowned(attributes(app));
        }),
      ),

    reconcile: ({ news, output }) =>
      inBrowser(
        Effect.gen(function* () {
          const slug = yield* workspace();
          const found = yield* find(slug, news.name, output?.applicationId);
          if (found === undefined) return attributes(yield* createOAuthApp(slug, news));
          if (drifted(found.settings, news)) yield* updateOAuthApp(slug, found.id, news);
          return attributes(found);
        }),
      ),

    delete: ({ output }) =>
      inBrowser(
        Effect.gen(function* () {
          yield* deleteOAuthApp(yield* workspace(), output.applicationId);
        }),
      ),
  });
