import { createSign } from "node:crypto";
import { Credentials } from "@distilled.cloud/github/Credentials";
import type { ConfigError } from "@distilled.cloud/github/Errors";
import { Octokit as _Octokit } from "@octokit/rest";
import type { AuthError } from "alchemy/Auth/AuthProvider";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import { effectiveGitHubBaseUrl } from "./BaseUrl.ts";

/**
 * An Octokit on the provider's `Credentials`, honoring a per-resource
 * `baseUrl` prop the same way `withBaseUrl` does for distilled calls.
 */
export const octokitFor = (
  baseUrl: string | undefined,
): Effect.Effect<_Octokit, AuthError | ConfigError, Credentials> =>
  Effect.gen(function* () {
    const apiBaseUrl = yield* effectiveGitHubBaseUrl(baseUrl);
    const { token, userAgent } = yield* yield* Credentials;
    return new _Octokit({ auth: Redacted.value(token), baseUrl: apiBaseUrl, userAgent });
  });

/**
 * An Octokit authenticated as a GitHub App: a short-lived RS256 JWT signed
 * with the app's private key (Octokit sends a three-part token as a Bearer
 * JWT). Build one per call — the JWT expires after nine minutes.
 */
export const appOctokit = (
  appId: number,
  privateKey: Redacted.Redacted<string>,
  baseUrl: string | undefined,
): _Octokit => {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // `iat` is backdated a minute to tolerate clock drift, as GitHub advises.
  const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: now - 60,
    exp: now + 540,
    iss: String(appId),
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(body)
    .sign(Redacted.value(privateKey), "base64url");
  return new _Octokit({
    auth: `${body}.${signature}`,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });
};

/** Run an Octokit call, resolving to `undefined` on the given HTTP statuses. */
export const unlessStatus = <A>(
  statuses: ReadonlyArray<number>,
  call: () => Promise<A>,
): Effect.Effect<A | undefined, Error> =>
  Effect.tryPromise({
    try: () =>
      call().catch((error: unknown) => {
        if (
          Predicate.hasProperty(error, "status") &&
          statuses.some((status) => status === error.status)
        ) {
          return undefined;
        }
        throw error;
      }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });

const freshAppKeyMessage = "Integration must generate a public key";

const isFreshAppKey = (error: unknown): boolean =>
  (Predicate.hasProperty(error, "message") &&
    typeof error.message === "string" &&
    error.message.includes(freshAppKeyMessage)) ||
  (Predicate.hasProperty(error, "cause") && isFreshAppKey(error.cause));

// GitHub rejects a freshly minted app key's JWT for a few seconds after the
// registration; the call succeeds once the key has propagated.
export const retryFreshAppKey = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.retry(effect, {
    while: isFreshAppKey,
    schedule: Schedule.spaced("2 seconds"),
    times: 10,
  });
