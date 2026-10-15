import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { CredentialsStoreLive } from "../Auth/Credentials.ts";
import { ProfileStoreLive } from "../Auth/Profile.ts";
import * as Provider from "../Provider.ts";
import { DopplerAuth } from "./AuthProvider.ts";
import { fromAuthProvider } from "./Client.ts";
import { Config, ConfigProvider } from "./Config.ts";
import { Environment, EnvironmentProvider } from "./Environment.ts";
import { Project, ProjectProvider } from "./Project.ts";
import { ProjectMember, ProjectMemberProvider } from "./ProjectMember.ts";
import { Secret, SecretProvider } from "./Secret.ts";
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
 * Config, Secret, ServiceAccount, ServiceAccountIdentity,
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
