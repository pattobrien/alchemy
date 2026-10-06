import { ConfigError } from "@distilled.cloud/core/errors";
import { Credentials } from "@distilled.cloud/inngest/Credentials";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  deferUntilFirstUse,
  orDieCredentialsUnavailable,
  resolveProviderConfig,
} from "../Auth/Resolve.ts";
import {
  INNGEST_AUTH_PROVIDER_NAME,
  type InngestAuthConfig,
  type InngestResolvedCredentials,
} from "./AuthProvider.ts";

export {
  Credentials,
  CredentialsFromEnv,
  DEFAULT_API_BASE_URL,
} from "@distilled.cloud/inngest/Credentials";

/**
 * Build a `Credentials` layer that resolves Inngest credentials via the
 * Alchemy AuthProvider using the configured profile.
 */
export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const resolve = yield* resolveProviderConfig<InngestAuthConfig, InngestResolvedCredentials>(
        INNGEST_AUTH_PROVIDER_NAME,
      ).pipe(
        Effect.flatMap(({ profileName, resolve }) =>
          resolve.pipe(
            Effect.map((creds) => ({ apiKey: creds.apiKey, apiBaseUrl: creds.apiBaseUrl })),
            Effect.mapError(
              (e) =>
                new ConfigError({
                  message: `Failed to resolve Inngest credentials from ${profileName === undefined ? "the CI environment" : `profile '${profileName}'`}: ${e.message}`,
                }),
            ),
          ),
        ),
        deferUntilFirstUse,
      );
      return yield* resolve.pipe(
        orDieCredentialsUnavailable(INNGEST_AUTH_PROVIDER_NAME),
        Effect.cached,
      );
    }),
  );
