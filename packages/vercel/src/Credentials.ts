import { ConfigError } from "@distilled.cloud/core/errors";
import { Credentials } from "@distilled.cloud/vercel/Credentials";
import { lazyCredentials } from "alchemy/Auth/Resolve";
import * as Layer from "effect/Layer";
import { VERCEL_AUTH_PROVIDER_NAME, type VercelResolvedCredentials } from "./AuthProvider.ts";

export {
  Credentials,
  CredentialsFromEnv,
  DEFAULT_API_BASE_URL,
} from "@distilled.cloud/vercel/Credentials";

/**
 * Build a `Credentials` layer that resolves Vercel credentials through the
 * Alchemy AuthProvider for the current profile.
 */
export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    lazyCredentials<VercelResolvedCredentials, ConfigError>()(
      VERCEL_AUTH_PROVIDER_NAME,
      (creds) => ({ token: creds.token, apiBaseUrl: creds.apiBaseUrl }),
    ),
  );
