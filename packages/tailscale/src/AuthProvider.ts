import { AuthError } from "alchemy/Auth/AuthProvider";
import { getEnv, getEnvRedacted } from "alchemy/Auth/Env";
import {
  makeStoredAuthProvider,
  storedSecret,
  storedValueText,
  type StoredAuthConfig,
  type StoredValues,
} from "alchemy/Auth/StoredAuthProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const TAILSCALE_AUTH_PROVIDER_NAME = "Tailscale";
export const TAILSCALE_API_KEY_ENV = "TAILSCALE_API_KEY";
export const TAILSCALE_OAUTH_CLIENT_ID_ENV = "TAILSCALE_OAUTH_CLIENT_ID";
export const TAILSCALE_OAUTH_CLIENT_SECRET_ENV = "TAILSCALE_OAUTH_CLIENT_SECRET";

export type TailscaleAuthConfig = StoredAuthConfig;

export type TailscaleAuth =
  | { readonly type: "apiKey"; readonly apiKey: Redacted.Redacted<string> }
  | {
      readonly type: "oauth";
      readonly clientId: string;
      readonly clientSecret: Redacted.Redacted<string>;
    };

export type TailscaleResolvedCredentials = {
  readonly auth: TailscaleAuth;
  readonly source: { type: TailscaleAuthConfig["method"] | "env"; details?: string };
};

interface AuthValues {
  readonly apiKey: Redacted.Redacted<string> | undefined;
  readonly clientId: string | undefined;
  readonly clientSecret: Redacted.Redacted<string> | undefined;
}

const nonEmpty = (value: Redacted.Redacted<string> | undefined) =>
  value !== undefined && Redacted.value(value).length > 0 ? value : undefined;

const authFrom = (
  values: AuthValues,
  names: { apiKey: string; clientId: string; clientSecret: string },
): Effect.Effect<TailscaleAuth, AuthError> => {
  const apiKey = nonEmpty(values.apiKey);
  const clientId = values.clientId || undefined;
  const clientSecret = nonEmpty(values.clientSecret);
  if (apiKey !== undefined && (clientId !== undefined || clientSecret !== undefined)) {
    return AuthError.make({
      message: `Tailscale: set ${names.apiKey}, or ${names.clientId} and ${names.clientSecret}, not both.`,
    });
  }
  if (apiKey !== undefined) return Effect.succeed({ type: "apiKey", apiKey });
  if (clientId !== undefined && clientSecret !== undefined) {
    return Effect.succeed({ type: "oauth", clientId, clientSecret });
  }
  return AuthError.make({
    message: `Tailscale credentials are missing. Set ${names.apiKey}, or ${names.clientId} and ${names.clientSecret}.`,
  });
};

const storedNames = {
  apiKey: "apiKey",
  clientId: "oauthClientId",
  clientSecret: "oauthClientSecret",
};

const storedValues = (values: StoredValues): AuthValues => ({
  apiKey: storedSecret(values.apiKey),
  clientId: storedValueText(values.oauthClientId),
  clientSecret: storedSecret(values.oauthClientSecret),
});

const envNames = {
  apiKey: TAILSCALE_API_KEY_ENV,
  clientId: TAILSCALE_OAUTH_CLIENT_ID_ENV,
  clientSecret: TAILSCALE_OAUTH_CLIENT_SECRET_ENV,
};

const tailscaleAuth = makeStoredAuthProvider<TailscaleResolvedCredentials>({
  provider: TAILSCALE_AUTH_PROVIDER_NAME,
  fields: [
    { name: storedNames.apiKey, label: "Tailscale API access token", secret: true, optional: true },
    { name: storedNames.clientId, label: "Tailscale OAuth client ID", optional: true },
    {
      name: storedNames.clientSecret,
      label: "Tailscale OAuth client secret",
      secret: true,
      optional: true,
    },
  ],
  complete: (values) => authFrom(storedValues(values), storedNames).pipe(Effect.as(values)),
  toResolved: (values) => {
    const { apiKey, clientId, clientSecret } = storedValues(values);
    return {
      auth:
        apiKey !== undefined
          ? { type: "apiKey", apiKey }
          : {
              type: "oauth",
              clientId: clientId ?? "",
              clientSecret: clientSecret ?? Redacted.make(""),
            },
      source: { type: "stored" },
    };
  },
  readEnvironment: Effect.all({
    apiKey: getEnvRedacted(TAILSCALE_API_KEY_ENV),
    clientId: getEnv(TAILSCALE_OAUTH_CLIENT_ID_ENV),
    clientSecret: getEnvRedacted(TAILSCALE_OAUTH_CLIENT_SECRET_ENV),
  }).pipe(
    Effect.flatMap((values) => authFrom(values, envNames)),
    Effect.map((auth) => ({
      auth,
      source: {
        type: "env" as const,
        details:
          auth.type === "apiKey"
            ? TAILSCALE_API_KEY_ENV
            : `${TAILSCALE_OAUTH_CLIENT_ID_ENV}, ${TAILSCALE_OAUTH_CLIENT_SECRET_ENV}`,
      },
    })),
  ),
  environment: [
    {
      name: TAILSCALE_API_KEY_ENV,
      required: true,
      secret: true,
      alternatives: [TAILSCALE_OAUTH_CLIENT_ID_ENV],
      description:
        "An API access token; or set TAILSCALE_OAUTH_CLIENT_ID and TAILSCALE_OAUTH_CLIENT_SECRET instead to exchange an OAuth client for tokens",
    },
    { name: TAILSCALE_OAUTH_CLIENT_SECRET_ENV, required: false, secret: true },
  ],
});

/**
 * Layer that registers the Tailscale {@link AuthProvider} into the
 * {@link AuthProviders} registry.
 *
 * Auth is an API access token (`TAILSCALE_API_KEY`), or an OAuth client
 * (`TAILSCALE_OAUTH_CLIENT_ID` and `TAILSCALE_OAUTH_CLIENT_SECRET`) whose
 * tokens are minted and refreshed on demand.
 */
export const TailscaleAuth = tailscaleAuth.layer;
