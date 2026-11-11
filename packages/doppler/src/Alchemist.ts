import type { Target } from "alchemy/Alchemist/Entrypoint";
import { resolveProfileName } from "alchemy/Auth/Resolve";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { exportStorageState, login } from "./Browser.ts";

const resolveProfile = (target: Target) =>
  resolveProfileName(Option.fromNullishOr(target.envFile), target.profile).pipe(
    Effect.map((name) => `${name}-doppler`),
  );

/**
 * Open Doppler's sign-in page in a window and save the session to the
 * browser profile once the user has signed in.
 */
export const browserLogin = Effect.fn("Alchemist.provider.doppler.browser-login")(function* (
  target: Target,
) {
  const profile = yield* resolveProfile(target);
  const result = yield* login({ profile });
  return { profile, ...result };
});

/**
 * The signed-in profile's Doppler session as Playwright storage state, for
 * `DOPPLER_BROWSER_STORAGE_STATE` where no profile exists (CI).
 */
export const browserExport = Effect.fn("Alchemist.provider.doppler.browser-export")(function* (
  target: Target,
) {
  const profile = yield* resolveProfile(target);
  return yield* exportStorageState({ profile });
});
