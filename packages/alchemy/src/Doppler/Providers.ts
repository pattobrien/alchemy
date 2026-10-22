import type * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import { CredentialsStoreLive } from "../Auth/Credentials.ts";
import { ProfileStoreLive } from "../Auth/Profile.ts";
import * as Provider from "../Provider.ts";
import { DopplerAuth } from "./AuthProvider.ts";
import * as Browser from "./Browser.ts";
import { fromAuthProvider } from "./Client.ts";
import { Config, ConfigProvider } from "./Config.ts";
import { Environment, EnvironmentProvider } from "./Environment.ts";
import { Project, ProjectProvider } from "./Project.ts";
import { ProjectMember, ProjectMemberProvider } from "./ProjectMember.ts";
import { Secret, SecretProvider } from "./Secret.ts";
import { SecretNote, SecretNoteProvider } from "./SecretNote.ts";
import { SecretReminder, SecretReminderProvider } from "./SecretReminder.ts";
import { ServiceAccount, ServiceAccountProvider } from "./ServiceAccount.ts";
import {
  ServiceAccountIdentity,
  ServiceAccountIdentityProvider,
} from "./ServiceAccountIdentity.ts";
import { ServiceAccountToken, ServiceAccountTokenProvider } from "./ServiceAccountToken.ts";
import { ServiceToken, ServiceTokenProvider } from "./ServiceToken.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("Doppler") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

export interface ProvidersOptions {
  /**
   * A signed-in browser session for what Doppler only offers in its
   * dashboard (secret reminders). `true` reads it from the environment
   * ({@link Browser.fromEnv}); an options object configures it directly
   * ({@link Browser.layer}).
   */
  readonly browser?: Browser.DopplerBrowserOptions | true;
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
 * Doppler providers and credentials. Wires up the Project, Environment,
 * Config, Secret, SecretNote, SecretReminder, ServiceAccount,
 * ServiceAccountIdentity, ServiceAccountToken, ProjectMember and ServiceToken
 * resources and registers the Doppler AuthProvider so `alchemy profile edit`
 * can configure it. Credentials come from `DOPPLER_TOKEN`, from
 * `DOPPLER_IDENTITY_ID` with the platform's OIDC token, or from the selected
 * profile.
 *
 * Pass `browser` to let `Doppler.SecretReminder` use the dashboard from a
 * profile signed in once with `alchemy provider doppler browser-login`:
 *
 * ```typescript
 * providers: Doppler.providers({ browser: true })
 * ```
 *
 * Where no signed-in profile exists, such as CI, `browser: true` restores the
 * session from `DOPPLER_BROWSER_STORAGE_STATE`, the Playwright storage state JSON.
 * `alchemy provider doppler browser-export` prints that JSON from the signed-in
 * profile. When the session expires, run `browser-login` and `browser-export` again.
 */
export const providers = ({ browser }: ProvidersOptions = {}) =>
  Layer.effect(
    Providers,
    Provider.collection([
      Project,
      Environment,
      Config,
      Secret,
      SecretNote,
      SecretReminder,
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
      SecretReminderProvider(),
      ServiceAccountProvider(),
      ServiceAccountIdentityProvider(),
      ServiceAccountTokenProvider(),
      ProjectMemberProvider(),
      ServiceTokenProvider(),
    ]),
    Layer.provideMerge(fromAuthProvider()),
    Layer.provideMerge(browserSession(browser)),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(DopplerAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
