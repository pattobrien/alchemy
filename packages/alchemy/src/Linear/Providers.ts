import { GraphQLLive } from "@distilled.cloud/linear";
import type * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import { CredentialsStoreLive } from "../Auth/Credentials.ts";
import { ProfileStoreLive } from "../Auth/Profile.ts";
import * as Provider from "../Provider.ts";
import { LinearAuth } from "./AuthProvider.ts";
import * as Browser from "./Browser.ts";
import * as Credentials from "./Credentials.ts";
import { CustomView, CustomViewProvider } from "./CustomView.ts";
import { IssueLabel, IssueLabelProvider } from "./IssueLabel.ts";
import { OAuthApp, OAuthAppProvider } from "./OAuthApp.ts";
import { Team, TeamProvider } from "./Team.ts";
import { TeamDefaults, TeamDefaultsProvider } from "./TeamDefaults.ts";
import { TeamLabel, TeamLabelProvider } from "./TeamLabel.ts";
import { Template, TemplateProvider } from "./Template.ts";
import { Webhook, WebhookProvider } from "./Webhook.ts";
import { WorkflowState, WorkflowStateProvider } from "./WorkflowState.ts";
import { WorkspaceLabel, WorkspaceLabelProvider } from "./WorkspaceLabel.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("Linear") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

export interface ProvidersOptions {
  /**
   * Credentials to act as instead of the AuthProvider's, such as an OAuth
   * application via {@link Credentials.fromClientCredentials}.
   */
  readonly credentials?: Layer.Layer<
    Credentials.Credentials,
    never,
    HttpClient.HttpClient | Layer.Services<ReturnType<typeof Credentials.fromAuthProvider>>
  >;
  /**
   * A signed-in browser session for what Linear only offers in its web UI
   * (OAuth applications). `true` reads it from the environment
   * ({@link Browser.fromEnv}); an options object configures it directly
   * ({@link Browser.layer}).
   */
  readonly browser?: Browser.LinearBrowserOptions | true;
}

const browserSession = (
  browser: ProvidersOptions["browser"],
): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path> =>
  browser === undefined
    ? Layer.empty
    : browser === true
      ? Browser.fromEnv()
      : Browser.layer(browser);

/**
 * Linear providers and credentials. Wires up the Team, TeamDefaults,
 * WorkflowState, Template, IssueLabel, TeamLabel, WorkspaceLabel, CustomView,
 * Webhook and OAuthApp resources and registers the Linear AuthProvider
 * so `alchemy profile edit` can configure it. Credentials come from
 * `LINEAR_API_KEY` when it is set, otherwise from the selected profile.
 *
 * Pass `credentials` to act as something else, such as an OAuth application
 * via {@link Credentials.fromClientCredentials}, and `browser` to let
 * `Linear.OAuthApp` drive Linear's settings UI in a profile signed in once
 * with `alchemy provider linear browser-login`:
 *
 * ```typescript
 * providers: Linear.providers({
 *   credentials: Linear.fromClientCredentials({
 *     clientId: Config.String("LINEAR_CLIENT_ID"),
 *     clientSecret: Config.Redacted("LINEAR_CLIENT_SECRET"),
 *     scopes: ["read", "write"],
 *   }),
 *   browser: true,
 * })
 * ```
 */
export const providers = ({
  credentials = Credentials.fromAuthProvider(),
  browser,
}: ProvidersOptions = {}) =>
  Layer.effect(
    Providers,
    Provider.collection([
      Team,
      TeamDefaults,
      WorkflowState,
      Template,
      IssueLabel,
      TeamLabel,
      WorkspaceLabel,
      CustomView,
      Webhook,
      OAuthApp,
    ]),
  ).pipe(
    Layer.provide([
      TeamProvider(),
      TeamDefaultsProvider(),
      WorkflowStateProvider(),
      TemplateProvider(),
      IssueLabelProvider(),
      TeamLabelProvider(),
      WorkspaceLabelProvider(),
      CustomViewProvider(),
      WebhookProvider(),
      OAuthAppProvider(),
    ]),
    Layer.provideMerge(GraphQLLive),
    Layer.provideMerge(credentials),
    Layer.provideMerge(browserSession(browser)),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(LinearAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
