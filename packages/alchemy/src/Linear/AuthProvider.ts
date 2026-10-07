import { DEFAULT_API_BASE_URL } from "@distilled.cloud/linear";
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

export const LINEAR_AUTH_PROVIDER_NAME = "Linear";

export type LinearAuthConfig = StoredAuthConfig;

/**
 * Resolved Linear credentials. A personal API key acts as the user who
 * created it, so it reaches every team that user can see in one workspace.
 */
export interface LinearResolvedCredentials {
  apiKey: Redacted.Redacted<string>;
  apiBaseUrl: string;
  source: { type: LinearAuthConfig["method"] | "env"; details?: string };
}

const readEnvironment = Effect.gen(function* () {
  const apiKey = yield* getEnvRedacted("LINEAR_API_KEY");
  if (!apiKey) {
    return yield* new AuthError({
      message: "Linear CI credentials not found. Set LINEAR_API_KEY.",
    });
  }
  return {
    apiKey,
    apiBaseUrl: (yield* getEnv("LINEAR_API_URL")) ?? DEFAULT_API_BASE_URL,
    source: { type: "env" as const },
  };
});

const linearAuth = makeStoredAuthProvider<LinearResolvedCredentials>({
  provider: LINEAR_AUTH_PROVIDER_NAME,
  fields: [
    {
      name: "apiKey",
      label: "Linear personal API key",
      secret: true,
    },
    {
      name: "apiBaseUrl",
      label: "Linear API Base URL",
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
      name: "LINEAR_API_KEY",
      required: true,
      secret: true,
      description: "Personal API key from Settings, Security & access.",
    },
    {
      name: "LINEAR_API_URL",
      required: false,
      description: "API host, such as an emulator.",
    },
  ],
});

/**
 * Layer that registers the Linear {@link AuthProvider} into the
 * {@link AuthProviders} registry when built. Included in
 * `Linear.providers()` so the alchemy CLI can discover it.
 */
export const LinearAuth = linearAuth.layer;

/** Schema of Linear's inline static-key values. */
export const LinearStoredCredentials = linearAuth.storedSchema;
export type LinearStoredCredentials = typeof LinearStoredCredentials.Type;
