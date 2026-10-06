import * as Inngest from "@distilled.cloud/inngest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import type { Inngest as InngestClient, InngestFunction } from "inngest";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import type { InputProps } from "../Input.ts";
import * as Provider from "../Provider.ts";
import type { ResourceBinding } from "../Resource.ts";
import { Resource } from "../Resource.ts";
import { makeBranchEnvironmentApi } from "./BranchEnvironmentApi.ts";
import type { Providers } from "./Providers.ts";

export interface AppProps {
  /**
   * The app id, the `id` given to `new Inngest({ id })`. `Inngest.App` reads
   * it from `client`. Changing it triggers a replacement.
   */
  appId: string;
  /** Full URL of the app's serve endpoint, e.g. `https://api.example.com/api/inngest`. */
  url: string;
  /**
   * A value that changes whenever the host deploys new code, such as a
   * Worker's `hash`. It orders the sync after the host's deploy.
   */
  version?: unknown;
  /**
   * Name of the branch environment the host syncs into, matching its
   * `INNGEST_ENV`. The sync unarchives the environment and reads the app
   * from it.
   */
  environment?: string;
  /**
   * Base URL of the Inngest Dev Server the app registers with during
   * `alchemy dev`, usually `Inngest.DevServer`'s `url`. Ignored by
   * `alchemy deploy`, which syncs with Inngest Cloud.
   * @default "http://localhost:8288"
   */
  devServer?: string;
}

export interface AppAttributes {
  /** The app id. */
  appId: string;
  /** The serve endpoint Inngest synced. */
  url: string;
  /** The branch environment the app lives in, if any. */
  environment: string | undefined;
  /** Slugs of the functions Inngest reports for the app, sorted. */
  functions: string[];
}

/** One function the host serves, recorded as a binding on `Inngest.App`. */
export interface AppFunctionBinding {
  /** The function id, `fn.id()`. */
  id: string;
  /** Whether the function has an `onFailure` handler. */
  onFailure: boolean;
  /** The function's options as plain data, without handlers or middleware. */
  config: Record<string, unknown>;
}

export type AppResource = Resource<
  "Inngest.App",
  AppProps,
  AppAttributes,
  AppFunctionBinding,
  Providers
>;

export const AppResource = Resource<AppResource>("Inngest.App");

export type AppOptions = InputProps<Omit<AppProps, "appId">> & {
  /** The Inngest client, `new Inngest({ id })`. Its `id` is the app id. */
  client: InngestClient.Any;
  /** The functions the host serves. */
  functions: ReadonlyArray<InngestFunction.Any>;
};

export class AppSyncFailed extends Data.TaggedError("Inngest.AppSyncFailed")<{
  appId: string;
  url: string;
  message: string;
}> {}

export class AppArchived extends Data.TaggedError("Inngest.AppArchived")<{
  appId: string;
  environment: string | undefined;
  message: string;
}> {}

export class AppEnvironmentMissing extends Data.TaggedError("Inngest.AppEnvironmentMissing")<{
  appId: string;
  environment: string;
}> {
  override get message() {
    return `Inngest did not create branch environment '${this.environment}' after syncing app '${this.appId}'. The host must set INNGEST_ENV to '${this.environment}' and sign with a key of the same account.`;
  }
}

export class AppFunctionsOutOfSync extends Data.TaggedError("Inngest.AppFunctionsOutOfSync")<{
  appId: string;
  missing: string[];
  unexpected: string[];
}> {
  override get message() {
    return `Inngest app '${this.appId}' does not match its functions after sync (missing: ${this.missing.join(", ") || "none"}; unexpected: ${this.unexpected.join(", ") || "none"})`;
  }
}

const toBindingData = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item !== "function").map(toBindingData);
  }
  if (value === null || typeof value !== "object") return value;
  if ("toJSON" in value && typeof value.toJSON === "function") return value.toJSON();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const text = String(value);
    return text === "[object Object]" ? value.constructor.name : text;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => typeof field !== "function")
      .map(([key, field]) => [key, toBindingData(field)]),
  );
};

const functionConfig = (fn: InngestFunction.Any): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fn.opts)
      .filter(([key, field]) => key !== "middleware" && typeof field !== "function")
      .map(([key, field]) => [key, toBindingData(field)]),
  );

const FAILURE_SUFFIX = "-failure";

export const expectedFunctionSlugs = (
  bindings: ReadonlyArray<ResourceBinding<AppFunctionBinding>>,
) =>
  bindings
    .flatMap(({ data }) => (data.onFailure ? [data.id, `${data.id}${FAILURE_SUFFIX}`] : [data.id]))
    .sort();

export const compareFunctions = (appId: string, expected: string[], reported: string[]) => {
  const missing = expected.filter((slug) => !reported.includes(slug));
  const unexpected = reported.filter((slug) => !expected.includes(slug));
  return missing.length > 0 || unexpected.length > 0
    ? Effect.fail(new AppFunctionsOutOfSync({ appId, missing, unexpected }))
    : Effect.succeed(reported);
};

/**
 * An Inngest app, synced from the client and functions its host serves.
 *
 * `Inngest.App` takes the same `client` and `functions` the host passes to
 * `serve`, and records each function's configuration as its own binding, so
 * the plan lists every function that was added, changed or removed. The host
 * can be any runtime: a Cloudflare Worker, a Lambda, a container. On deploy
 * the app asks Inngest to sync `url`, then checks that Inngest reports
 * exactly those functions. Functions the host no longer serves are archived
 * by that sync.
 *
 * Inngest has no API to delete an app, so destroying `Inngest.App` leaves it
 * in place. Destroy its `Inngest.BranchEnvironment` to archive a preview app.
 * An app that already exists when the stack first deploys is only adopted
 * with `--adopt`.
 * @see https://www.inngest.com/docs/apps/cloud
 *
 * ### Syncing an app
 * **Example:** App served by a Worker
 * ```typescript
 * import { functions, inngest } from "./src/inngest.ts";
 *
 * const worker = yield* Cloudflare.Worker("api", { main: "./src/worker.ts" });
 *
 * yield* Inngest.App("app", {
 *   client: inngest,
 *   functions,
 *   url: Output.interpolate`${worker.url}/api/inngest`,
 *   version: worker.hash,
 * });
 * ```
 *
 * ### Preview deploys
 * **Example:** App in a branch environment
 * ```typescript
 * import { functions, inngest } from "./src/inngest.ts";
 *
 * const env = yield* Inngest.BranchEnvironment("preview");
 * const worker = yield* Cloudflare.Worker("api", {
 *   main: "./src/worker.ts",
 *   env: { INNGEST_ENV: env.name },
 * });
 *
 * yield* Inngest.App("app", {
 *   client: inngest,
 *   functions,
 *   url: Output.interpolate`${worker.url}/api/inngest`,
 *   version: worker.hash,
 *   environment: env.name,
 * });
 * ```
 *
 * @resource
 * @product Apps
 */
export const App = (
  id: string,
  { client, functions, url, version, environment, devServer }: AppOptions,
) =>
  Effect.gen(function* () {
    const app = yield* AppResource(id, {
      appId: client.id,
      url,
      version,
      environment,
      devServer,
    });
    for (const fn of functions) {
      yield* app.bind(fn.id(), {
        id: fn.id(),
        onFailure: Boolean(fn.opts.onFailure),
        config: functionConfig(fn),
      });
    }
    return app;
  });

export const AppProvider = () =>
  Provider.effect(
    AppResource,
    Effect.gen(function* () {
      const syncApp = yield* Inngest.syncV2App;
      const getApp = yield* Inngest.getV2App;
      const listFunctions = yield* Inngest.getV2Functions;
      const environments = yield* makeBranchEnvironmentApi;

      const observe = (appId: string, environment: string | undefined) =>
        getApp({ appId, xInngestEnv: environment }).pipe(
          Effect.map((res) => res.data),
          Effect.catchTag("AppNotFound", () => Effect.succeed(undefined)),
        );

      const observeFunctions = (appId: string, environment: string | undefined) =>
        listFunctions.items({ appId, xInngestEnv: environment }).pipe(
          Stream.map((fn) => fn.slug),
          Stream.filter((slug): slug is string => slug !== undefined),
          Stream.runCollect,
          Effect.map((slugs) => [...slugs].sort()),
        );

      const sync = Effect.fn(
        function* (appId: string, url: string, environment: string | undefined) {
          const result = yield* syncApp({ appId, url, xInngestEnv: environment });
          const status = result.data?.status;
          if (status === "error") {
            return yield* new AppSyncFailed({
              appId,
              url,
              message: result.data?.error?.message ?? "Inngest reported a failed sync",
            });
          }
          return status;
        },
        Effect.retry({
          while: (e) => e._tag === "AppUnreachable",
          schedule: Schedule.spaced("2 seconds"),
          times: 10,
        }),
      );

      const awaitEnvironment = Effect.fn(function* (appId: string, environment: string) {
        const env = yield* environments.observe(environment).pipe(
          Effect.repeat({
            schedule: Schedule.spaced("2 seconds"),
            until: (env) => env !== undefined,
            times: 15,
          }),
        );
        if (env === undefined) {
          return yield* new AppEnvironmentMissing({ appId, environment });
        }
      });

      const awaitSync = Effect.fn(function* (
        appId: string,
        url: string,
        environment: string | undefined,
      ) {
        const latest = yield* observe(appId, environment).pipe(
          Effect.map((app) => app?.latestSync),
          Effect.repeat({
            schedule: Schedule.spaced("2 seconds"),
            until: (sync) => sync?.status !== undefined && sync.status !== "pending",
            times: 15,
          }),
        );
        if (latest?.status === "error" || latest?.status === "pending") {
          return yield* new AppSyncFailed({
            appId,
            url,
            message: latest.error ?? `Inngest sync of '${appId}' did not finish within 30 seconds`,
          });
        }
      });

      const syncFunctions = Effect.fn(
        function* (
          appId: string,
          url: string,
          environment: string | undefined,
          environmentExists: boolean,
          expected: string[],
        ) {
          const status = yield* sync(appId, url, environmentExists ? environment : undefined);
          if (environment !== undefined && !environmentExists) {
            yield* awaitEnvironment(appId, environment);
          }
          if (status === "pending") {
            yield* awaitSync(appId, url, environment);
          }
          const reported = yield* observeFunctions(appId, environment);
          return yield* compareFunctions(appId, expected, reported);
        },
        Effect.retry({
          while: (e) => e._tag === "Inngest.AppFunctionsOutOfSync",
          schedule: Schedule.spaced("3 seconds"),
          times: 8,
        }),
      );

      return {
        stables: ["appId"],
        nuke: { skip: true },
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news) || output === undefined) return undefined;
          if (news.appId !== output.appId) {
            return { action: "replace" } as const;
          }
          return undefined;
        }),
        reconcile: Effect.fn(function* ({ news, bindings }) {
          const { appId, url, environment } = news;
          const environmentExists =
            environment === undefined ||
            (yield* environments.setArchived(environment, false)) !== undefined;
          const observed = environmentExists ? yield* observe(appId, environment) : undefined;
          if (observed?.isArchived) {
            return yield* new AppArchived({
              appId,
              environment,
              message: `Inngest app '${appId}' is archived. Unarchive it in the Inngest dashboard, or deploy to a new branch environment name.`,
            });
          }
          const functions = yield* syncFunctions(
            appId,
            url,
            environment,
            environmentExists,
            expectedFunctionSlugs(bindings),
          );
          const synced = yield* observe(appId, environment);
          return { appId, url: synced?.latestSync?.url ?? url, environment, functions };
        }),
        delete: Effect.fn(function* ({ output, session }) {
          yield* session.note(
            `Inngest has no API to delete apps. App '${output.appId}' was removed from state but stays in ${output.environment === undefined ? "its environment" : `environment '${output.environment}'`} until that environment is archived.`,
          );
        }),
        read: Effect.fn(function* ({ olds, output }) {
          const appId = output?.appId ?? olds.appId;
          const environment = output?.environment ?? olds.environment;
          if (environment !== undefined) {
            const env = yield* environments.observe(environment);
            if (env === undefined || env.isArchived) return undefined;
          }
          const observed = yield* observe(appId, environment);
          if (observed === undefined || observed.isArchived) return undefined;
          const attrs = {
            appId,
            url: observed.latestSync?.url ?? output?.url ?? olds.url,
            environment,
            functions: yield* observeFunctions(appId, environment),
          };
          return output === undefined ? Unowned(attrs) : attrs;
        }),
      };
    }),
  );
