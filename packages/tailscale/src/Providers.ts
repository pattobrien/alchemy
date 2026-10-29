import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import * as Provider from "alchemy/Provider";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { TailscaleAuth } from "./AuthProvider.ts";
import { fromAuthProvider } from "./Credentials.ts";
import { Policy, PolicyProvider } from "./Policy.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("Tailscale") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Tailscale providers and credentials. Wires up the Policy resource and
 * registers the Tailscale AuthProvider so `alchemy profile edit` can
 * configure it. Credentials come from `TAILSCALE_API_KEY`, from
 * `TAILSCALE_OAUTH_CLIENT_ID` with `TAILSCALE_OAUTH_CLIENT_SECRET`, or from
 * the selected profile.
 */
export const providers = () =>
  Layer.effect(Providers, Provider.collection([Policy])).pipe(
    Layer.provide(PolicyProvider()),
    Layer.provideMerge(fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(TailscaleAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
