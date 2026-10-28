import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import * as Provider from "alchemy/Provider";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { VercelAuth } from "./AuthProvider.ts";
import * as Credentials from "./Credentials.ts";
import { Project, ProjectProvider } from "./Project.ts";
import { ProjectDomain, ProjectDomainProvider } from "./ProjectDomain.ts";
import { Team, TeamProvider } from "./Team.ts";

export { Credentials } from "@distilled.cloud/vercel/Credentials";

export class Providers extends Provider.ProviderCollection<Providers>()("Vercel") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Vercel providers and credentials. Wires up the Team, Project and
 * ProjectDomain resources, and registers the Vercel AuthProvider so
 * `alchemy profile edit` can configure it.
 */
export const providers = () =>
  Layer.effect(Providers, Provider.collection([Project, ProjectDomain, Team])).pipe(
    Layer.provide(Layer.mergeAll(ProjectProvider(), ProjectDomainProvider(), TeamProvider())),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(VercelAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
