import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import * as Provider from "alchemy/Provider";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { NamespaceLabsAuth } from "./AuthProvider.ts";
import { Builder, BuilderProvider } from "./Builder.ts";
import { fromAuthProvider } from "./Credentials.ts";
import { Devbox, DevboxProvider } from "./Devbox.ts";
import { DevboxTemplate, DevboxTemplateProvider } from "./DevboxTemplate.ts";
import { RunnerProfile, RunnerProfileProvider } from "./RunnerProfile.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("NamespaceLabs") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Namespace providers and credentials. Wires up the RunnerProfile,
 * DevboxTemplate, Devbox and Builder resources and registers the Namespace
 * AuthProvider so `alchemy profile edit` can configure it. Credentials come
 * from `NSC_TOKEN` (and `NSC_REGION`) or from the selected profile.
 */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([RunnerProfile, DevboxTemplate, Devbox, Builder]),
  ).pipe(
    Layer.provide([
      RunnerProfileProvider(),
      DevboxTemplateProvider(),
      DevboxProvider(),
      BuilderProvider(),
    ]),
    Layer.provideMerge(fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(NamespaceLabsAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
