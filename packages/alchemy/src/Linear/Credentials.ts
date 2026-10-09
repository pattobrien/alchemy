import { ConfigError } from "@distilled.cloud/core/errors";
import { Credentials, DEFAULT_API_BASE_URL, toConfig } from "@distilled.cloud/linear";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
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

const TokenResponse = Schema.Struct({ access_token: Schema.String });

/**
 * Mint an app-actor access token with Linear's OAuth `client_credentials`
 * grant. The OAuth application must have client credentials enabled.
 */
export const clientCredentialsToken = Effect.fn("Linear.clientCredentialsToken")(
  function* (options: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly scopes: readonly string[];
    readonly apiBaseUrl?: string;
  }) {
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(`${options.apiBaseUrl ?? DEFAULT_API_BASE_URL}/oauth/token`).pipe(
        HttpClientRequest.basicAuth(options.clientId, Redacted.value(options.clientSecret)),
        HttpClientRequest.bodyUrlParams({
          grant_type: "client_credentials",
          scope: options.scopes.join(","),
        }),
      ),
    ).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
    const body = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response);
    return Redacted.make(body.access_token);
  },
);

/**
 * Build a `Credentials` layer that acts as an OAuth application, minting its
 * token with the `client_credentials` grant. Needed for operations that only
 * an app actor may call, such as managing {@link OAuthApp}s with the
 * `oauth:create` scope.
 */
export const fromClientCredentials = (options: {
  readonly clientId: Config.Config<string>;
  readonly clientSecret: Config.Config<Redacted.Redacted<string>>;
  readonly scopes: readonly string[];
  readonly apiBaseUrl?: string;
}) =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      return yield* Effect.gen(function* () {
        const clientId = yield* options.clientId;
        const clientSecret = yield* options.clientSecret;
        const token = yield* clientCredentialsToken({ ...options, clientId, clientSecret });
        return toConfig({ token, tokenKind: "oauth", apiBaseUrl: options.apiBaseUrl });
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        orDieCredentialsUnavailable(LINEAR_AUTH_PROVIDER_NAME),
        Effect.cached,
      );
    }),
  );
