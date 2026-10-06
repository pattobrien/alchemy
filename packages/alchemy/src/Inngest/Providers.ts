import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { CredentialsStoreLive } from "../Auth/Credentials.ts";
import { ProfileStoreLive } from "../Auth/Profile.ts";
import * as Provider from "../Provider.ts";
import { InngestAuth } from "./AuthProvider.ts";
import { BranchEnvironment, BranchEnvironmentProvider } from "./BranchEnvironment.ts";
import * as Credentials from "./Credentials.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("Inngest") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Inngest providers and credentials. Wires up the BranchEnvironment resource
 * and registers the Inngest AuthProvider so `alchemy profile edit` can
 * configure it.
 */
export const providers = () =>
  Layer.effect(Providers, Provider.collection([BranchEnvironment])).pipe(
    Layer.provide(BranchEnvironmentProvider()),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(InngestAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
