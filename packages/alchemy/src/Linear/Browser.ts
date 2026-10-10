import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { errors, type Page } from "playwright-core";
import { browserProfileDir } from "../Auth/Paths.ts";
import { DEFAULT_PROFILE_NAME } from "../Auth/Profile.ts";
import * as Browser from "../Browser.ts";
import { UserFacingError } from "../UserFacingError.ts";

export const LOGIN_COMMAND = "alchemy provider linear browser-login";

export const LINEAR_ORIGIN = "https://linear.app";

export interface LinearProfileOptions {
  /** Browser profile name under `~/.alchemy/browser`. @default `<alchemy profile>-linear` */
  readonly profile?: string;
  /** Absolute browser profile directory; overrides `profile`. */
  readonly profileDir?: string;
  /** @default true */
  readonly headless?: boolean;
  readonly storageState?: Browser.StorageState | string;
  readonly connect?: never;
}

export interface LinearConnectOptions {
  readonly connect: Browser.BrowserConnection;
}

export type LinearBrowserOptions = LinearProfileOptions | LinearConnectOptions;

export type LinearBrowserSession = { readonly profileDir: string } | { readonly cdpUrl: string };

export class LinearBrowserSignedOut extends Data.TaggedError("LinearBrowserSignedOut")<{
  readonly url: string;
  readonly session: LinearBrowserSession;
}> {
  readonly [UserFacingError] = true;
  override get message(): string {
    return "cdpUrl" in this.session
      ? `Linear is not signed in on ${this.url} (remote browser: ${this.session.cdpUrl}). Sign in its default context.`
      : `Linear is not signed in on ${this.url} (browser profile: ${this.session.profileDir}). Run \`${LOGIN_COMMAND}\` to sign in.`;
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
  }
>()("Linear::Browser") {}

const SIGNED_OUT = /^\/(login|signup|auth)(\/|$)/;

const LOGIN_HEADING = "Log in to Linear";

const ACCOUNT_STORE = "ApplicationStore";

const inWorkspace = (url: URL) =>
  url.origin === LINEAR_ORIGIN && url.pathname !== "/" && !SIGNED_OUT.test(url.pathname);

const settle = async (page: Page, timeout: number) => {
  await page.waitForURL(inWorkspace, { timeout }).catch((error: unknown) => {
    if (!(error instanceof errors.TimeoutError)) throw error;
  });
  await page.waitForLoadState();
  return inWorkspace(new URL(page.url()));
};

const resolveProfileDir = (options: LinearProfileOptions) =>
  Effect.sync(
    () =>
      options.profileDir ??
      browserProfileDir(
        options.profile ?? `${process.env.ALCHEMY_PROFILE ?? DEFAULT_PROFILE_NAME}-linear`,
      ),
  );

const sessionOf = (
  options: LinearBrowserOptions,
): Effect.Effect<{
  readonly session: LinearBrowserSession;
  readonly browser: Layer.Layer<Browser.Browser, never, FileSystem.FileSystem | Path.Path>;
}> =>
  options.connect === undefined
    ? Effect.map(resolveProfileDir(options), (profileDir) => ({
        session: { profileDir },
        browser: Browser.layer({
          profileDir,
          headless: options.headless,
          storageState: options.storageState,
        }),
      }))
    : Effect.succeed({
        session: { cdpUrl: options.connect.cdpUrl },
        browser: Browser.layer({ connect: options.connect }),
      });

export const layer = (
  options: LinearBrowserOptions = {},
): Layer.Layer<LinearBrowser, never, FileSystem.FileSystem | Path.Path> =>
  Layer.unwrap(
    Effect.map(sessionOf(options), ({ session, browser: browserLayer }) =>
      Layer.effect(
        LinearBrowser,
        Effect.gen(function* () {
          const browser = yield* Browser.Browser;
          return LinearBrowser.of({
            page: (url, f) =>
              browser
                .withPage(url, async (page) => {
                  const login = page.getByRole("heading", { name: LOGIN_HEADING });
                  await page.getByRole("main").or(login).first().waitFor();
                  if (await login.isVisible()) {
                    throw new LinearBrowserSignedOut({ url, session });
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
      ).pipe(Layer.provide(browserLayer)),
    ),
  );

const storageStateFromEnv = Effect.suspend(() => {
  const json = process.env.LINEAR_BROWSER_STORAGE_STATE;
  return json === undefined
    ? Effect.succeed(undefined)
    : Schema.decodeUnknownEffect(Schema.fromJsonString(Browser.StorageState))(json).pipe(
        Effect.catch(() =>
          Effect.die(new Error("LINEAR_BROWSER_STORAGE_STATE is not a Playwright storage state")),
        ),
      );
});

export const fromEnv = (overrides: LinearProfileOptions = {}) =>
  Layer.unwrap(
    Effect.map(storageStateFromEnv, (storageState) =>
      layer({
        profileDir: process.env.ALCHEMY_LINEAR_BROWSER_PROFILE,
        headless: process.env.LINEAR_BROWSER_HEADLESS !== "0",
        storageState,
        ...overrides,
      }),
    ),
  );

const signedIn = (profileDir: string, headless: boolean, timeout: number) =>
  Browser.Browser.use((browser) =>
    browser.withPage(`${LINEAR_ORIGIN}/login`, (page) => settle(page, timeout)),
  ).pipe(Effect.provide(Browser.layer({ profileDir, headless })));

export const login = Effect.fn("Linear.browserLogin")(function* (
  options: Omit<LinearProfileOptions, "headless"> = {},
) {
  const profileDir = yield* resolveProfileDir({
    profileDir: process.env.ALCHEMY_LINEAR_BROWSER_PROFILE,
    ...options,
  });
  if (yield* signedIn(profileDir, true, 10_000)) return { profileDir };
  if (!(yield* signedIn(profileDir, false, 30 * 60_000))) {
    return yield* new LinearBrowserSignedOut({
      url: `${LINEAR_ORIGIN}/login`,
      session: { profileDir },
    });
  }
  return { profileDir };
});

export const exportStorageState = Effect.fn("Linear.browserExport")(function* (
  options: Pick<LinearProfileOptions, "profile" | "profileDir"> = {},
) {
  const profileDir = yield* resolveProfileDir({
    profileDir: process.env.ALCHEMY_LINEAR_BROWSER_PROFILE,
    ...options,
  });
  const session = yield* Browser.Browser.use((browser) =>
    browser.withPage(`${LINEAR_ORIGIN}/login`, async (page) => {
      const signedIn = await settle(page, 10_000);
      const { origins } = await page.context().storageState();
      return {
        signedIn,
        state: {
          cookies: await page.context().cookies(LINEAR_ORIGIN),
          origins: origins
            .filter((entry) => entry.origin === LINEAR_ORIGIN)
            .map((entry) => ({
              origin: entry.origin,
              localStorage: entry.localStorage.filter((item) => item.name === ACCOUNT_STORE),
            })),
        },
      };
    }),
  ).pipe(Effect.provide(Browser.layer({ profileDir })));
  if (!session.signedIn) {
    return yield* new LinearBrowserSignedOut({
      url: `${LINEAR_ORIGIN}/login`,
      session: { profileDir },
    });
  }
  return session.state;
});
