import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import * as Provider from "alchemy/Provider";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { DopplerAuth } from "./AuthProvider.ts";
import { fromAuthProvider } from "./Client.ts";
import { Config, ConfigProvider } from "./Config.ts";
import { Environment, EnvironmentProvider } from "./Environment.ts";
import { Project, ProjectProvider } from "./Project.ts";
import { ProjectMember, ProjectMemberProvider } from "./ProjectMember.ts";
import { Secret, SecretProvider } from "./Secret.ts";
import { SecretNote, SecretNoteProvider } from "./SecretNote.ts";
import { ServiceAccount, ServiceAccountProvider } from "./ServiceAccount.ts";
import {
  ServiceAccountIdentity,
  ServiceAccountIdentityProvider,
} from "./ServiceAccountIdentity.ts";
import { ServiceAccountToken, ServiceAccountTokenProvider } from "./ServiceAccountToken.ts";
import { ServiceToken, ServiceTokenProvider } from "./ServiceToken.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("Doppler") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Doppler providers and credentials. Wires up the Project, Environment,
 * Config, Secret, SecretNote, ServiceAccount, ServiceAccountIdentity,
 * ServiceAccountToken, ProjectMember and ServiceToken resources and registers
 * the Doppler AuthProvider so `alchemy profile edit` can configure it.
 * Credentials come from `DOPPLER_TOKEN`, from `DOPPLER_IDENTITY_ID` with the
 * platform's OIDC token, or from the selected profile.
 */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      Project,
      Environment,
      Config,
      Secret,
      SecretNote,
      ServiceAccount,
      ServiceAccountIdentity,
      ServiceAccountToken,
      ProjectMember,
      ServiceToken,
    ]),
  ).pipe(
    Layer.provide([
      ProjectProvider(),
      EnvironmentProvider(),
      ConfigProvider(),
      SecretProvider(),
      SecretNoteProvider(),
      ServiceAccountProvider(),
      ServiceAccountIdentityProvider(),
      ServiceAccountTokenProvider(),
      ProjectMemberProvider(),
      ServiceTokenProvider(),
    ]),
    Layer.provideMerge(fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(DopplerAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
