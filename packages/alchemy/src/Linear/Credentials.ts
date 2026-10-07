import { ConfigError } from "@distilled.cloud/core/errors";
import { Credentials, toConfig } from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  deferUntilFirstUse,
  orDieCredentialsUnavailable,
  resolveProviderConfig,
} from "../Auth/Resolve.ts";
import {
  LINEAR_AUTH_PROVIDER_NAME,
  type LinearAuthConfig,
  type LinearResolvedCredentials,
} from "./AuthProvider.ts";

export {
  Credentials,
  CredentialsFromEnv,
  CredentialsFromToken,
  DEFAULT_API_BASE_URL,
} from "@distilled.cloud/linear";

/**
 * Build a `Credentials` layer that resolves Linear credentials via the
 * Alchemy AuthProvider using the configured profile.
 */
export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const resolve = yield* resolveProviderConfig<LinearAuthConfig, LinearResolvedCredentials>(
        LINEAR_AUTH_PROVIDER_NAME,
      ).pipe(
        Effect.flatMap(({ profileName, resolve }) =>
          resolve.pipe(
            Effect.map((creds) => toConfig({ token: creds.apiKey, apiBaseUrl: creds.apiBaseUrl })),
            Effect.mapError(
              (e) =>
                new ConfigError({
                  message: `Failed to resolve Linear credentials from ${profileName === undefined ? "the CI environment" : `profile '${profileName}'`}: ${e.message}`,
                }),
            ),
          ),
        ),
        deferUntilFirstUse,
      );
      return yield* resolve.pipe(
        orDieCredentialsUnavailable(LINEAR_AUTH_PROVIDER_NAME),
        Effect.cached,
      );
    }),
  );
