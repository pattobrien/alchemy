import * as Inngest from "@distilled.cloud/inngest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import type { FunctionConfig } from "inngest/types";
import { isResolved } from "../Diff.ts";
import type { InputProps } from "../Input.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { loadAppModule } from "./AppModule.ts";
import { makeBranchEnvironmentApi } from "./BranchEnvironmentApi.ts";
import type { Providers } from "./Providers.ts";

export interface AppProps {
  /**
   * The app id, the `id` given to `new Inngest({ id })`. `Inngest.App` reads
   * it from `main`. Changing it triggers a replacement.
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
  /** Slugs of the functions Inngest reported after the sync. */
  functions: string[];
}

export type AppResource = Resource<
  "Inngest.App",
  AppProps,
  AppAttributes,
  FunctionConfig,
  Providers
>;

export const AppResource = Resource<AppResource>("Inngest.App");

export type AppOptions = InputProps<Omit<AppProps, "appId">> & {
  /**
   * Module that exports the Inngest client and its functions, either as a
   * `functions` array or as individual exports. The host imports the same
   * module and serves it.
   */
  main: string;
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

export class AppFunctionsOutOfSync extends Data.TaggedError("Inngest.AppFunctionsOutOfSync")<{
  appId: string;
  missing: string[];
  unexpected: string[];
}> {
  override get message() {
    return `Inngest app '${this.appId}' does not match main after sync (missing: ${this.missing.join(", ") || "none"}; unexpected: ${this.unexpected.join(", ") || "none"})`;
  }
}

class AppEnvironmentMissing extends Data.TaggedError("Inngest.AppEnvironmentMissing")<{
  environment: string;
}> {}

/**
 * An Inngest app, synced from the module that defines its functions.
 *
 * `Inngest.App` imports `main` while the stack is planned and records each
 * function's configuration as its own binding, so the plan lists every
 * function that was added, changed or removed. The host that serves `main`
 * can be any runtime: a Cloudflare Worker, a Lambda, a container. On deploy
 * the app asks Inngest to sync `url`, then checks that Inngest reports exactly
 * the functions in `main`. Functions removed from `main` are archived by that sync.
 *
 * Inngest has no API to delete an app, so destroying `Inngest.App` leaves it
 * in place. Destroy its `Inngest.BranchEnvironment` to archive a preview app.
 * @see https://www.inngest.com/docs/apps/cloud
 *
 * ### Syncing an app
 * **Example:** App served by a Worker
 * ```typescript
 * const worker = yield* Cloudflare.Worker("api", { main: "./src/worker.ts" });
 *
 * yield* Inngest.App("app", {
 *   main: "./src/inngest.ts",
 *   url: Output.interpolate`${worker.url}/api/inngest`,
 *   version: worker.hash,
 * });
 * ```
 *
 * ### Preview deploys
 * **Example:** App in a branch environment
 * ```typescript
 * const env = yield* Inngest.BranchEnvironment("preview");
 * const worker = yield* Cloudflare.Worker("api", {
 *   main: "./src/worker.ts",
 *   env: { INNGEST_ENV: env.name },
 * });
 *
 * yield* Inngest.App("app", {
 *   main: "./src/inngest.ts",
 *   url: Output.interpolate`${worker.url}/api/inngest`,
 *   version: worker.hash,
 *   environment: env.name,
 * });
 * ```
 *
 * @resource
 * @product Apps
 */
export const App = (id: string, { main, url, version, environment, devServer }: AppOptions) =>
  Effect.gen(function* () {
    const module = yield* loadAppModule(main).pipe(Effect.orDie);
    const app = yield* AppResource(id, {
      appId: module.appId,
      url,
      version,
      environment,
      devServer,
    });
    for (const fn of module.functions) {
      yield* app.bind(fn.slug, fn.config);
    }
    return app;
  });

export const isFailureHandler = (config: FunctionConfig) =>
  config.triggers.some(
    (trigger) => "event" in trigger && trigger.event === "inngest/function.failed",
  );

export const AppProvider = () =>
  Provider.effect(
    AppResource,
    Effect.gen(function* () {
      const syncApp = yield* Inngest.syncV2App;
      const getApp = yield* Inngest.getV2App;
      const listFunctions = yield* Inngest.getV2Functions;
      const environments = yield* makeBranchEnvironmentApi;

      const sync = Effect.fn(
        function* (appId: string, url: string) {
          const result = yield* syncApp({ appId, url });
          if (result.data?.status === "error") {
            return yield* new AppSyncFailed({
              appId,
              url,
              message: result.data.error?.message ?? "Inngest reported a failed sync",
            });
          }
          return result.data;
        },
        Effect.retry({
          while: (e) => e._tag === "AppUnreachable",
          schedule: Schedule.spaced("2 seconds"),
          times: 15,
        }),
      );

      const activate = Effect.fn(
        function* (environment: string) {
          const env = yield* environments.setArchived(environment, false);
          if (env?.id === undefined) {
            return yield* new AppEnvironmentMissing({ environment });
          }
        },
        Effect.retry({
          while: (e) => e._tag === "Inngest.AppEnvironmentMissing",
          schedule: Schedule.spaced("1 second"),
          times: 5,
        }),
      );

      const ensureActive = Effect.fn(function* (appId: string, environment: string | undefined) {
        const app = yield* getApp({ appId, xInngestEnv: environment });
        if (app.data?.isArchived) {
          return yield* new AppArchived({
            appId,
            environment,
            message: `Inngest app '${appId}' is archived. Unarchive it in the Inngest dashboard, or deploy to a new branch environment name.`,
          });
        }
      });

      const verifyFunctions = Effect.fn(function* (
        appId: string,
        environment: string | undefined,
        expected: string[],
      ) {
        const reported = yield* listFunctions.items({ appId, xInngestEnv: environment }).pipe(
          Stream.map((fn) => fn.slug),
          Stream.runCollect,
        );
        const missing = expected.filter((slug) => !reported.includes(slug));
        const unexpected = reported.filter(
          (slug): slug is string => slug !== undefined && !expected.includes(slug),
        );
        if (missing.length > 0 || unexpected.length > 0) {
          return yield* new AppFunctionsOutOfSync({ appId, missing, unexpected });
        }
      });

      const syncFunctions = Effect.fn(
        function* (props: AppProps, expected: string[]) {
          const { appId, url, environment } = props;
          yield* sync(appId, url);
          if (environment !== undefined) {
            yield* activate(environment);
          }
          yield* ensureActive(appId, environment);
          yield* verifyFunctions(appId, environment, expected);
        },
        Effect.retry({
          while: (e) => e._tag === "Inngest.AppFunctionsOutOfSync",
          schedule: Schedule.spaced("3 seconds"),
          times: 10,
        }),
      );

      return {
        stables: ["appId"],
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news) || output === undefined) return undefined;
          if (news.appId !== output.appId) {
            return { action: "replace" } as const;
          }
          return undefined;
        }),
        reconcile: Effect.fn(function* ({ news, bindings }) {
          const { appId, url, environment } = news;
          if (environment !== undefined) {
            yield* environments.setArchived(environment, false);
          }
          const functions = bindings
            .filter((binding) => !isFailureHandler(binding.data))
            .map((binding) => binding.sid)
            .sort();
          yield* syncFunctions(news, functions);
          return { appId, url, environment, functions };
        }),
        delete: Effect.fn(function* () {}),
        read: Effect.fn(function* ({ output }) {
          if (output === undefined) return undefined;
          const app = yield* getApp({
            appId: output.appId,
            xInngestEnv: output.environment,
          }).pipe(Effect.catchTag("AppNotFound", () => Effect.succeed(undefined)));
          return app?.data === undefined ? undefined : output;
        }),
      };
    }),
  );
