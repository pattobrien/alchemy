import { DEFAULT_API_BASE_URL } from "@distilled.cloud/vercel/Credentials";
import { getEnv, getEnvRedactedRequired } from "alchemy/Auth/Env";
import {
  makeStoredAuthProvider,
  storedSecret,
  storedValueText,
  type StoredAuthConfig,
} from "alchemy/Auth/StoredAuthProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const VERCEL_AUTH_PROVIDER_NAME = "Vercel";

export type VercelAuthConfig = StoredAuthConfig;

export type VercelResolvedCredentials = {
  type: "token";
  token: Redacted.Redacted<string>;
  apiBaseUrl: string;
  source: { type: VercelAuthConfig["method"] | "env"; details?: string };
};

const vercelAuth = makeStoredAuthProvider<VercelResolvedCredentials>({
  provider: VERCEL_AUTH_PROVIDER_NAME,
  fields: [
    { name: "token", label: "Vercel Access Token", secret: true },
    {
      name: "apiBaseUrl",
      label: "Vercel API Base URL",
      optional: true,
      placeholder: DEFAULT_API_BASE_URL,
    },
  ],
  toResolved: (values, source) => ({
    type: "token",
    token: storedSecret(values.token) ?? Redacted.make(""),
    apiBaseUrl: storedValueText(values.apiBaseUrl) ?? DEFAULT_API_BASE_URL,
    source: { type: source },
  }),
  readEnvironment: Effect.gen(function* () {
    const token = yield* getEnvRedactedRequired("VERCEL_TOKEN");
    const apiBaseUrl = (yield* getEnv("VERCEL_API_URL")) ?? DEFAULT_API_BASE_URL;
    return { type: "token" as const, token, apiBaseUrl, source: { type: "env" as const } };
  }),
  environment: [
    {
      name: "VERCEL_TOKEN",
      required: true,
      secret: true,
      description: "Vercel access token.",
    },
    {
      name: "VERCEL_API_URL",
      required: false,
      description: "API base URL override.",
    },
  ],
});

/**
 * Layer that registers the Vercel {@link AuthProvider} into the
 * {@link AuthProviders} registry.
 */
export const VercelAuth = vercelAuth.layer;
