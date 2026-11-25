import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import * as ProviderLayer from "alchemy/Local/ProviderLayer";
import * as Provider from "alchemy/Provider";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { AppProvider, AppResource } from "./App.ts";
import { InngestAuth } from "./AuthProvider.ts";
import { BranchEnvironment, BranchEnvironmentProvider } from "./BranchEnvironment.ts";
import * as Credentials from "./Credentials.ts";
import { DevServer, DevServerProvider } from "./DevServer.ts";
import { EventKey, EventKeyProvider } from "./EventKey.ts";
import { LocalAppProvider } from "./LocalAppProvider.ts";
import { SigningKey, SigningKeyProvider } from "./SigningKey.ts";
import { Webhook, WebhookProvider } from "./Webhook.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("Inngest") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Inngest providers and credentials. Wires up the App, BranchEnvironment,
 * DevServer, Webhook, EventKey and SigningKey resources and registers the
 * Inngest AuthProvider so `alchemy profile edit` can configure it.
 */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([AppResource, BranchEnvironment, DevServer, Webhook, EventKey, SigningKey]),
  ).pipe(
    Layer.provide([
      ProviderLayer.dual(AppResource, { live: AppProvider, local: LocalAppProvider }),
      BranchEnvironmentProvider(),
      DevServerProvider(),
      WebhookProvider(),
      EventKeyProvider(),
      SigningKeyProvider(),
    ]),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(InngestAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
