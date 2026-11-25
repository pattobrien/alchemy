import { ConfigError } from "@distilled.cloud/core/errors";
import { Credentials } from "@distilled.cloud/inngest/Credentials";
import { lazyCredentials } from "alchemy/Auth/Resolve";
import * as Layer from "effect/Layer";
import { INNGEST_AUTH_PROVIDER_NAME, type InngestResolvedCredentials } from "./AuthProvider.ts";

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
    lazyCredentials<InngestResolvedCredentials, ConfigError>()(
      INNGEST_AUTH_PROVIDER_NAME,
      (creds) => ({ apiKey: creds.apiKey, apiBaseUrl: creds.apiBaseUrl }),
    ),
  );
