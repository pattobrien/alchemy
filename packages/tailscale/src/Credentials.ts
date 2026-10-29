import type { ConfigError } from "@distilled.cloud/core/errors";
import {
  Credentials,
  DEFAULT_API_BASE_URL,
  DEFAULT_TAILNET,
  makeClientCredentials,
  type Config,
} from "@distilled.cloud/tailscale";
import {
  deferUntilFirstUse,
  orDieCredentialsUnavailable,
  resolveProviderConfig,
} from "alchemy/Auth/Resolve";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import {
  TAILSCALE_AUTH_PROVIDER_NAME,
  type TailscaleAuth,
  type TailscaleAuthConfig,
  type TailscaleResolvedCredentials,
} from "./AuthProvider.ts";

export {
  Credentials,
  CredentialsFromEnv,
  DEFAULT_API_BASE_URL,
  DEFAULT_TAILNET,
  fromApiKey,
  fromClientCredentials,
  type Config as CredentialsConfig,
} from "@distilled.cloud/tailscale";

const toClient = (
  auth: TailscaleAuth,
): Effect.Effect<Effect.Effect<Config, ConfigError>, never, HttpClient.HttpClient> =>
  auth.type === "apiKey"
    ? Effect.succeed(
        Effect.succeed({
          token: auth.apiKey,
          apiBaseUrl: DEFAULT_API_BASE_URL,
          tailnet: DEFAULT_TAILNET,
        }),
      )
    : makeClientCredentials({ clientId: auth.clientId, clientSecret: auth.clientSecret });

/**
 * Build a `Credentials` layer that resolves Tailscale credentials via the
 * Alchemy AuthProvider: the environment when `TAILSCALE_API_KEY` or the
 * OAuth client variables are set, otherwise the selected profile. An OAuth
 * client is exchanged for access tokens that refresh before they expire.
 */
export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const resolve = yield* resolveProviderConfig<
        TailscaleAuthConfig,
        TailscaleResolvedCredentials
      >(TAILSCALE_AUTH_PROVIDER_NAME).pipe(
        Effect.flatMap(({ resolve }) => resolve),
        Effect.flatMap(({ auth }) => toClient(auth)),
        deferUntilFirstUse,
      );
      const client = yield* resolve.pipe(
        orDieCredentialsUnavailable(TAILSCALE_AUTH_PROVIDER_NAME),
        Effect.cached,
      );
      return Effect.flatten(client);
    }),
  );
