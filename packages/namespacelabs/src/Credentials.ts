import { Credentials, resolveConfig } from "@distilled.cloud/namespacelabs";
import {
  deferUntilFirstUse,
  orDieCredentialsUnavailable,
  resolveProviderConfig,
} from "alchemy/Auth/Resolve";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  NAMESPACELABS_AUTH_PROVIDER_NAME,
  type NamespaceLabsAuthConfig,
  type NamespaceLabsResolvedCredentials,
} from "./AuthProvider.ts";

export {
  Credentials,
  CredentialsFromEnv,
  CredentialsFromTokenFile,
  DEFAULT_REGION,
  credentials,
  fromToken,
  fromTokenFile,
  type Config as CredentialsConfig,
} from "@distilled.cloud/namespacelabs";

/**
 * Build a `Credentials` layer that resolves Namespace credentials via the
 * Alchemy AuthProvider: the environment when `NSC_TOKEN` is set, otherwise
 * the selected profile.
 */
export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const resolve = yield* resolveProviderConfig<
        NamespaceLabsAuthConfig,
        NamespaceLabsResolvedCredentials
      >(NAMESPACELABS_AUTH_PROVIDER_NAME).pipe(
        Effect.flatMap(({ resolve }) => resolve),
        Effect.map(({ token, region }) => resolveConfig({ token, region })),
        deferUntilFirstUse,
      );
      return yield* resolve.pipe(
        orDieCredentialsUnavailable(NAMESPACELABS_AUTH_PROVIDER_NAME),
        Effect.cached,
      );
    }),
  );
