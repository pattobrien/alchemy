import type { LinearGlobalError, QueryError } from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";

export const ignoreNotFound = <A, R>(effect: Effect.Effect<A, QueryError<LinearGlobalError>, R>) =>
  effect.pipe(Effect.catchTag("LinearNotFound", () => Effect.void));

export const changes = <T extends object, K extends keyof T>(
  live: Pick<T, K>,
  desired: T,
  keys: readonly K[],
): Partial<Pick<T, K>> => {
  const patch: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (desired[key] !== undefined && desired[key] !== live[key]) patch[key] = desired[key];
  }
  return patch;
};

export const isEmpty = (patch: object) => Object.keys(patch).length === 0;
