import { ConfigError } from "@distilled.cloud/core/errors";
import { Credentials, resolveConfig } from "@distilled.cloud/namespacelabs";
import { lazyCredentials } from "alchemy/Auth/Resolve";
import * as Layer from "effect/Layer";
import {
  NAMESPACELABS_AUTH_PROVIDER_NAME,
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
    lazyCredentials<NamespaceLabsResolvedCredentials, ConfigError>()(
      NAMESPACELABS_AUTH_PROVIDER_NAME,
      ({ token, region }) => resolveConfig({ token, region }),
    ),
  );
