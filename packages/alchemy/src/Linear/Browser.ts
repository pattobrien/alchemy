import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import { errors, type Page } from "playwright-core";
import { browserProfileDir } from "../Auth/Paths.ts";
import { DEFAULT_PROFILE_NAME } from "../Auth/Profile.ts";
import * as Browser from "../Browser.ts";
import { UserFacingError } from "../UserFacingError.ts";

export const LOGIN_COMMAND = "alchemy provider linear browser-login";

export const LINEAR_ORIGIN = "https://linear.app";

export interface LinearBrowserOptions {
  /** Browser profile name under `~/.alchemy/browser`. @default `<alchemy profile>-linear` */
  readonly profile?: string;
  /** Absolute browser profile directory; overrides `profile`. */
  readonly profileDir?: string;
  /** @default true */
  readonly headless?: boolean;
}

export class LinearBrowserSignedOut extends Data.TaggedError("LinearBrowserSignedOut")<{
  readonly url: string;
  readonly profileDir: string;
}> {
  readonly [UserFacingError] = true;
  override get message(): string {
    return `Linear is not signed in on ${this.url} (browser profile: ${this.profileDir}). Run \`${LOGIN_COMMAND}\` to sign in.`;
  }
}

export type LinearBrowserError = LinearBrowserSignedOut | Browser.BrowserError;

export class LinearBrowser extends Context.Service<
  LinearBrowser,
  {
    readonly page: <A>(
      url: string,
      f: (page: Page) => Promise<A>,
    ) => Effect.Effect<A, LinearBrowserError>;
    readonly profileDir: string;
  }
>()("Linear::Browser") {}

const SIGNED_OUT = /^\/(login|signup|auth)(\/|$)/;

const LOGIN_HEADING = "Log in to Linear";

const inWorkspace = (url: URL) =>
  url.origin === LINEAR_ORIGIN && url.pathname !== "/" && !SIGNED_OUT.test(url.pathname);

const settle = async (page: Page, timeout: number) => {
  await page.waitForURL(inWorkspace, { timeout }).catch((error: unknown) => {
    if (!(error instanceof errors.TimeoutError)) throw error;
  });
  await page.waitForLoadState();
  return inWorkspace(new URL(page.url()));
};

const resolveProfileDir = (options: LinearBrowserOptions) =>
  Effect.sync(
    () =>
      options.profileDir ??
      browserProfileDir(
        options.profile ?? `${process.env.ALCHEMY_PROFILE ?? DEFAULT_PROFILE_NAME}-linear`,
      ),
  );

export const layer = (
  options: LinearBrowserOptions = {},
): Layer.Layer<LinearBrowser, never, FileSystem.FileSystem | Path.Path> =>
  Layer.unwrap(
    Effect.map(resolveProfileDir(options), (profileDir) =>
      Layer.effect(
        LinearBrowser,
        Effect.gen(function* () {
          const browser = yield* Browser.Browser;
          return LinearBrowser.of({
            profileDir,
            page: (url, f) =>
              browser
                .withPage(url, async (page) => {
                  const login = page.getByRole("heading", { name: LOGIN_HEADING });
                  await page.getByRole("main").or(login).first().waitFor();
                  if (await login.isVisible()) {
                    throw new LinearBrowserSignedOut({ url, profileDir });
                  }
                  return f(page);
                })
                .pipe(
                  Effect.catchTag("BrowserAutomationFailed", (error) =>
                    Effect.fail(
                      error.cause instanceof LinearBrowserSignedOut ? error.cause : error,
                    ),
                  ),
                ),
          });
        }),
      ).pipe(Layer.provide(Browser.layer({ profileDir, headless: options.headless }))),
    ),
  );

export const fromEnv = (overrides: LinearBrowserOptions = {}) =>
  layer({
    profileDir: process.env.ALCHEMY_LINEAR_BROWSER_PROFILE,
    headless: process.env.LINEAR_BROWSER_HEADLESS !== "0",
    ...overrides,
  });

const signedIn = (profileDir: string, headless: boolean, timeout: number) =>
  Browser.Browser.use((browser) =>
    browser.withPage(`${LINEAR_ORIGIN}/login`, (page) => settle(page, timeout)),
  ).pipe(Effect.provide(Browser.layer({ profileDir, headless })));

export const login = Effect.fn("Linear.browserLogin")(function* (
  options: Omit<LinearBrowserOptions, "headless"> = {},
) {
  const profileDir = yield* resolveProfileDir({
    profileDir: process.env.ALCHEMY_LINEAR_BROWSER_PROFILE,
    ...options,
  });
  if (yield* signedIn(profileDir, true, 10_000)) return { profileDir };
  if (!(yield* signedIn(profileDir, false, 30 * 60_000))) {
    return yield* new LinearBrowserSignedOut({ url: `${LINEAR_ORIGIN}/login`, profileDir });
  }
  return { profileDir };
});
