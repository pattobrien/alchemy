import { GraphQLLive } from "@distilled.cloud/linear";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { CredentialsStoreLive } from "../Auth/Credentials.ts";
import { ProfileStoreLive } from "../Auth/Profile.ts";
import * as Provider from "../Provider.ts";
import { LinearAuth } from "./AuthProvider.ts";
import * as Credentials from "./Credentials.ts";
import { CustomView, CustomViewProvider } from "./CustomView.ts";
import { IssueLabel, IssueLabelProvider } from "./IssueLabel.ts";
import { Team, TeamProvider } from "./Team.ts";
import { TeamDefaults, TeamDefaultsProvider } from "./TeamDefaults.ts";
import { TeamLabel, TeamLabelProvider } from "./TeamLabel.ts";
import { Template, TemplateProvider } from "./Template.ts";
import { Webhook, WebhookProvider } from "./Webhook.ts";
import { WorkflowState, WorkflowStateProvider } from "./WorkflowState.ts";
import { WorkspaceLabel, WorkspaceLabelProvider } from "./WorkspaceLabel.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("Linear") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Linear providers and credentials. Wires up the Team, TeamDefaults,
 * WorkflowState, Template, IssueLabel, TeamLabel, WorkspaceLabel, CustomView
 * and Webhook resources and registers the Linear AuthProvider
 * so `alchemy profile edit` can configure it. Credentials come from
 * `LINEAR_API_KEY` when it is set, otherwise from the selected profile.
 */
export const providers = () =>
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
    ]),
    Layer.provideMerge(GraphQLLive),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(LinearAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
