import { Credentials, DEFAULT_API_BASE_URL, type DopplerOpError } from "@distilled.cloud/doppler";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import {
  deferUntilFirstUse,
  orDieCredentialsUnavailable,
  resolveProviderConfig,
} from "../Auth/Resolve.ts";
import type { DopplerAuthConfig, DopplerResolvedCredentials } from "./AuthProvider.ts";

export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const resolve = yield* resolveProviderConfig<DopplerAuthConfig, DopplerResolvedCredentials>(
        "Doppler",
      ).pipe(
        Effect.flatMap(({ resolve }) => resolve),
        Effect.map(({ token }) => ({ apiKey: token, apiBaseUrl: DEFAULT_API_BASE_URL })),
        deferUntilFirstUse,
      );
      return yield* resolve.pipe(orDieCredentialsUnavailable("Doppler"), Effect.cached);
    }),
  );

const isNotFound = (error: { readonly _tag: string }) => error._tag === "NotFound";

export const orUndefined = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.catchIf(isNotFound, () => Effect.succeed(undefined)));

export const ignoreNotFound = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchIf(isNotFound, () => Effect.void),
  );

export const reveal = (value: string | Redacted.Redacted<string> | null | undefined) =>
  Redacted.isRedacted(value) ? Redacted.value(value) : (value ?? undefined);

export const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item) => b.includes(item));

export const PAGE_SIZE = 100;

export const findInPages = <T, R>(
  list: (page: {
    page: number;
    per_page: number;
  }) => Effect.Effect<readonly T[] | undefined, DopplerOpError, R>,
  match: (item: T) => boolean,
) =>
  Effect.gen(function* () {
    for (let page = 1; ; page++) {
      const items = (yield* list({ page, per_page: PAGE_SIZE })) ?? [];
      const found = items.find(match);
      if (found !== undefined || items.length < PAGE_SIZE) return found;
    }
  });
