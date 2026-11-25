import { ConfigError } from "@distilled.cloud/core/errors";
import {
  Credentials,
  DEFAULT_API_BASE_URL,
  makeClientCredentials,
  type Config,
} from "@distilled.cloud/tailscale/Credentials";
import { lazyCredentials } from "alchemy/Auth/Resolve";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SynchronizedRef from "effect/SynchronizedRef";
import {
  TAILSCALE_AUTH_PROVIDER_NAME,
  type TailscaleAuth,
  type TailscaleResolvedCredentials,
} from "./AuthProvider.ts";

export {
  Credentials,
  CredentialsFromEnv,
  DEFAULT_API_BASE_URL,
  fromApiKey,
  fromClientCredentials,
  type Config as CredentialsConfig,
} from "@distilled.cloud/tailscale/Credentials";

const toClient = (
  auth: TailscaleAuth,
): Effect.Effect<Effect.Effect<Config, ConfigError>, never, HttpClient.HttpClient> =>
  auth.type === "apiKey"
    ? Effect.succeed(Effect.succeed({ token: auth.apiKey, apiBaseUrl: DEFAULT_API_BASE_URL }))
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
      const http = yield* HttpClient.HttpClient;
      const auth = yield* lazyCredentials<TailscaleResolvedCredentials, ConfigError>()(
        TAILSCALE_AUTH_PROVIDER_NAME,
        (creds) => creds.auth,
      );
      const client = yield* SynchronizedRef.make(Option.none<Effect.Effect<Config, ConfigError>>());
      return SynchronizedRef.modifyEffect(client, (current) =>
        Option.isSome(current)
          ? Effect.succeed([current.value, current] as const)
          : auth.pipe(
              Effect.flatMap(toClient),
              Effect.provideService(HttpClient.HttpClient, http),
              Effect.map((resolve) => [resolve, Option.some(resolve)] as const),
            ),
      ).pipe(Effect.flatten);
    }),
  );
