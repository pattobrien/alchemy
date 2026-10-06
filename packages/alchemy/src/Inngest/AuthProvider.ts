import { DEFAULT_API_BASE_URL } from "@distilled.cloud/inngest/Credentials";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { AuthError } from "../Auth/AuthProvider.ts";
import { getEnv, getEnvRedacted } from "../Auth/Env.ts";
import {
  makeStoredAuthProvider,
  storedSecret,
  storedValueText,
  type StoredAuthConfig,
} from "../Auth/StoredAuthProvider.ts";

export const INNGEST_AUTH_PROVIDER_NAME = "Inngest";

export type InngestAuthConfig = StoredAuthConfig;

/**
 * Resolved Inngest credentials. Inngest scopes every key to one environment,
 * so the key decides which environments the provider can reach: a production
 * API key reaches production, and the branch environment signing key reaches
 * the `branch` parent and every branch environment under it.
 */
export interface InngestResolvedCredentials {
  apiKey: Redacted.Redacted<string>;
  apiBaseUrl: string;
  source: { type: InngestAuthConfig["method"] | "env"; details?: string };
}

const readEnvironment = Effect.gen(function* () {
  const apiKey = yield* getEnvRedacted("INNGEST_API_KEY");
  if (!apiKey) {
    return yield* new AuthError({
      message: "Inngest CI credentials not found. Set INNGEST_API_KEY.",
    });
  }
  return {
    apiKey,
    apiBaseUrl: (yield* getEnv("INNGEST_API_BASE_URL")) ?? DEFAULT_API_BASE_URL,
    source: { type: "env" as const },
  };
});

const inngestAuth = makeStoredAuthProvider<InngestResolvedCredentials>({
  provider: INNGEST_AUTH_PROVIDER_NAME,
  fields: [
    {
      name: "apiKey",
      label: "Inngest API key or branch environment signing key",
      secret: true,
    },
    {
      name: "apiBaseUrl",
      label: "Inngest API Base URL",
      optional: true,
      placeholder: DEFAULT_API_BASE_URL,
    },
  ],
  toResolved: (values, source) => ({
    apiKey: storedSecret(values.apiKey) ?? Redacted.make(""),
    apiBaseUrl: storedValueText(values.apiBaseUrl) ?? DEFAULT_API_BASE_URL,
    source: { type: source },
  }),
  readEnvironment,
  environment: [
    {
      name: "INNGEST_API_KEY",
      required: true,
      secret: true,
      description:
        "API key or signing key. Branch environments need the branch environment signing key.",
    },
    {
      name: "INNGEST_API_BASE_URL",
      required: false,
      description: "REST API base URL.",
    },
  ],
});

/**
 * Layer that registers the Inngest {@link AuthProvider} into the
 * {@link AuthProviders} registry when built. Include this in the Inngest
 * `providers()` layer so the alchemy CLI can discover it.
 */
export const InngestAuth = inngestAuth.layer;

/** Schema of Inngest's inline static-key values. */
export const InngestStoredCredentials = inngestAuth.storedSchema;
export type InngestStoredCredentials = typeof InngestStoredCredentials.Type;
