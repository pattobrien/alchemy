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

export const LOGIN_COMMAND = "alchemy provider doppler browser-login";

export const DOPPLER_ORIGIN = "https://dashboard.doppler.com";

export interface DopplerProfileOptions {
  /** Browser profile name under `~/.alchemy/browser`. @default `<alchemy profile>-doppler` */
  readonly profile?: string;
  /** Absolute browser profile directory; overrides `profile`. */
  readonly profileDir?: string;
  /** @default true */
  readonly headless?: boolean;
  readonly storageState?: Browser.StorageState | string;
  readonly connect?: never;
}

export interface DopplerConnectOptions {
  readonly connect: Browser.BrowserConnection;
}

export type DopplerBrowserOptions = DopplerProfileOptions | DopplerConnectOptions;

export type DopplerBrowserSession = { readonly profileDir: string } | { readonly cdpUrl: string };

export class DopplerBrowserSignedOut extends Data.TaggedError("DopplerBrowserSignedOut")<{
  readonly url: string;
  readonly session: DopplerBrowserSession;
}> {
  readonly [UserFacingError] = true;
  override get message(): string {
    return "cdpUrl" in this.session
      ? `Doppler is not signed in on ${this.url} (remote browser: ${this.session.cdpUrl}). Sign in its default context.`
      : `Doppler is not signed in on ${this.url} (browser profile: ${this.session.profileDir}). Run \`${LOGIN_COMMAND}\` to sign in.`;
  }
}

/** The dashboard answered a request with `success: false`. */
export class DopplerDashboardRejected extends Data.TaggedError("DopplerDashboardRejected")<{
  readonly path: string;
  readonly messages: readonly string[];
}> {
  readonly [UserFacingError] = true;
  override get message(): string {
    return `Doppler rejected ${this.path}: ${this.messages.join("; ")}`;
  }
}

export type DopplerBrowserError =
  | DopplerBrowserSignedOut
  | DopplerDashboardRejected
  | Browser.BrowserError;

export class DopplerBrowser extends Context.Service<
  DopplerBrowser,
  {
    readonly page: <A>(
      url: string,
      f: (page: Page) => Promise<A>,
    ) => Effect.Effect<A, DopplerBrowserError>;
  }
>()("Doppler::Browser") {}

const SIGNED_OUT = /^\/(login|signup|register|sso)(\/|$)/;

const inWorkplace = (url: URL) =>
  url.origin === DOPPLER_ORIGIN && url.pathname.startsWith("/workplace/");

const settle = async (page: Page, timeout: number) => {
  await page.waitForURL(inWorkplace, { timeout }).catch((error: unknown) => {
    if (!(error instanceof errors.TimeoutError)) throw error;
  });
  await page.waitForLoadState();
  return inWorkplace(new URL(page.url()));
};

const resolveProfileDir = (options: DopplerProfileOptions) =>
  Effect.sync(
    () =>
      options.profileDir ??
      browserProfileDir(
        options.profile ?? `${process.env.ALCHEMY_PROFILE ?? DEFAULT_PROFILE_NAME}-doppler`,
      ),
  );

const sessionOf = (
  options: DopplerBrowserOptions,
): Effect.Effect<{
  readonly session: DopplerBrowserSession;
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

/** A dashboard request was redirected to the sign-in page mid-flow. */
export class SessionLost extends Error {
  constructor(readonly path: string) {
    super(`Doppler redirected ${path} to sign in`);
  }
}

const sessionError = (url: string, session: DopplerBrowserSession, cause: unknown) =>
  cause instanceof SessionLost
    ? new DopplerBrowserSignedOut({ url, session })
    : cause instanceof DopplerBrowserSignedOut || cause instanceof DopplerDashboardRejected
      ? cause
      : undefined;

export const layer = (
  options: DopplerBrowserOptions = {},
): Layer.Layer<DopplerBrowser, never, FileSystem.FileSystem | Path.Path> =>
  Layer.unwrap(
    Effect.map(sessionOf(options), ({ session, browser: browserLayer }) =>
      Layer.effect(
        DopplerBrowser,
        Effect.gen(function* () {
          const browser = yield* Browser.Browser;
          return DopplerBrowser.of({
            page: (url, f) =>
              browser
                .withPage(url, async (page) => {
                  const location = new URL(page.url());
                  if (!inWorkplace(location) && SIGNED_OUT.test(location.pathname)) {
                    throw new DopplerBrowserSignedOut({ url, session });
                  }
                  return f(page);
                })
                .pipe(
                  Effect.catchTag("BrowserAutomationFailed", (error) =>
                    Effect.fail(sessionError(url, session, error.cause) ?? error),
                  ),
                ),
          });
        }),
      ).pipe(Layer.provide(browserLayer)),
    ),
  );

const storageStateFromEnv = Effect.suspend(() => {
  const json = process.env.DOPPLER_BROWSER_STORAGE_STATE;
  return json === undefined
    ? Effect.succeed(undefined)
    : Schema.decodeUnknownEffect(Schema.fromJsonString(Browser.StorageState))(json).pipe(
        Effect.catch(() =>
          Effect.die(new Error("DOPPLER_BROWSER_STORAGE_STATE is not a Playwright storage state")),
        ),
      );
});

export const fromEnv = (overrides: DopplerProfileOptions = {}) =>
  Layer.unwrap(
    Effect.map(storageStateFromEnv, (storageState) =>
      layer({
        profileDir: process.env.ALCHEMY_DOPPLER_BROWSER_PROFILE,
        headless: process.env.DOPPLER_BROWSER_HEADLESS !== "0",
        storageState,
        ...overrides,
      }),
    ),
  );

const signedIn = (profileDir: string, headless: boolean, timeout: number) =>
  Browser.Browser.use((browser) =>
    browser.withPage(`${DOPPLER_ORIGIN}/login`, (page) => settle(page, timeout)),
  ).pipe(Effect.provide(Browser.layer({ profileDir, headless })));

export const login = Effect.fn("Doppler.browserLogin")(function* (
  options: Omit<DopplerProfileOptions, "headless"> = {},
) {
  const profileDir = yield* resolveProfileDir({
    profileDir: process.env.ALCHEMY_DOPPLER_BROWSER_PROFILE,
    ...options,
  });
  if (!(yield* signedIn(profileDir, false, 30 * 60_000))) {
    return yield* new DopplerBrowserSignedOut({
      url: `${DOPPLER_ORIGIN}/login`,
      session: { profileDir },
    });
  }
  return { profileDir };
});

export const exportStorageState = Effect.fn("Doppler.browserExport")(function* (
  options: Pick<DopplerProfileOptions, "profile" | "profileDir"> = {},
) {
  const profileDir = yield* resolveProfileDir({
    profileDir: process.env.ALCHEMY_DOPPLER_BROWSER_PROFILE,
    ...options,
  });
  const session = yield* Browser.Browser.use((browser) =>
    browser.withPage(`${DOPPLER_ORIGIN}/login`, async (page) => ({
      signedIn: await settle(page, 10_000),
      state: { cookies: await page.context().cookies(DOPPLER_ORIGIN), origins: [] },
    })),
  ).pipe(Effect.provide(Browser.layer({ profileDir })));
  if (!session.signedIn) {
    return yield* new DopplerBrowserSignedOut({
      url: `${DOPPLER_ORIGIN}/login`,
      session: { profileDir },
    });
  }
  return session.state;
});
