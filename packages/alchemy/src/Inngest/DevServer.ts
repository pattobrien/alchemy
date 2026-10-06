import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { FQN_SEPARATOR } from "../FQN.ts";
import { makeDevLogOpener } from "../Local/DevLog.ts";
import * as LocalProvider from "../Local/LocalProvider.ts";
import * as ProviderLayer from "../Local/ProviderLayer.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { Stage } from "../Stage.ts";
import { findAvailablePort, moduleExtension } from "../Util/Node.ts";
import type { Providers } from "./Providers.ts";

export const DEFAULT_DEV_SERVER_PORT = 8288;

export interface DevServerProps {
  /**
   * Port the Dev Server listens on. Its UI and API are served from
   * `http://localhost:<port>`.
   * @default 8288
   */
  port?: number;
  /**
   * Executable that runs the Inngest CLI. Install the `inngest-cli` package
   * as a dev dependency so it is on `PATH` when you run `alchemy dev`.
   * @default "inngest-cli"
   */
  command?: string;
}

export interface DevServerAttributes {
  /**
   * Base URL of the running Dev Server, e.g. `http://localhost:8288`.
   * `undefined` during `alchemy deploy`, where no Dev Server runs.
   */
  url: string | undefined;
  /**
   * Value for the host's `INNGEST_DEV`: the Dev Server URL during
   * `alchemy dev`, and `"0"` during `alchemy deploy` so the SDK runs in
   * cloud mode.
   */
  inngestDev: string;
}

export type DevServer = Resource<
  "Inngest.DevServer",
  DevServerProps,
  DevServerAttributes,
  never,
  Providers
>;

export class DevServerCommandNotFound extends Data.TaggedError("Inngest.DevServerCommandNotFound")<{
  command: string;
  message: string;
  cause?: unknown;
}> {}

export class DevServerExited extends Data.TaggedError("Inngest.DevServerExited")<{
  command: string;
  port: number;
  message: string;
}> {}

class DevServerNotReady extends Data.TaggedError("Inngest.DevServerNotReady")<{
  url: string;
}> {}

/**
 * The Inngest Dev Server, run on your machine during `alchemy dev`.
 *
 * `Inngest.DevServer` starts `inngest-cli dev` when the stack runs in dev
 * mode, waits until it is healthy, and exposes its base URL as `url`. Pass
 * `inngestDev` to the host as `INNGEST_DEV` so the Inngest SDK runs in dev
 * mode and registers with this Dev Server, and pass `url` to `Inngest.App`
 * as `devServer` so the app syncs into it. The Dev Server restarts when its
 * props change and stops when the dev session ends.
 *
 * During `alchemy deploy` nothing runs, `url` is `undefined` and
 * `inngestDev` is `"0"`, so the deployed host talks to Inngest Cloud. The
 * same stack serves both modes.
 *
 * The Dev Server is launched with `inngest-cli`. Add the `inngest-cli`
 * package to your dev dependencies, or set `command` to the executable.
 * @see https://www.inngest.com/docs/dev-server
 *
 * ### Local development
 * **Example:** Worker and app synced into the Dev Server
 * ```typescript
 * const devServer = yield* Inngest.DevServer("inngest");
 * const worker = yield* Cloudflare.Worker("api", {
 *   main: "./src/worker.ts",
 *   env: { INNGEST_DEV: devServer.inngestDev },
 * });
 *
 * yield* Inngest.App("app", {
 *   main: "./src/inngest.ts",
 *   url: Output.interpolate`${worker.url}/api/inngest`,
 *   version: worker.hash,
 *   devServer: devServer.url,
 * });
 * ```
 *
 * **Example:** Custom port and executable
 * ```typescript
 * const devServer = yield* Inngest.DevServer("inngest", {
 *   port: 9288,
 *   command: "./node_modules/.bin/inngest-cli",
 * });
 * ```
 *
 * @resource
 * @product Dev Server
 */
export const DevServer = Resource<DevServer>("Inngest.DevServer");

export const DevServerProvider = () =>
  ProviderLayer.dual(DevServer, {
    live: DevServerProviderLive,
    local: DevServerProviderLocal,
  });

export const DevServerProviderLive = () =>
  Provider.succeed(DevServer, {
    list: () => Effect.succeed([]),
    diff: () => Effect.succeed({ action: "noop" }),
    reconcile: () => Effect.succeed({ url: undefined, inngestDev: "0" }),
    delete: () => Effect.void,
  });

export const DevServerProviderLocal = () =>
  LocalProvider.make(
    DevServer,
    import.meta.resolve(`./Local${moduleExtension(import.meta.url)}`, import.meta.url),
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const client = yield* HttpClient.HttpClient;
      const stage = yield* Stage;
      const openDevLog = yield* makeDevLogOpener;

      const awaitHealthy = (url: string) =>
        client.get(`${url}/health`).pipe(
          Effect.flatMap((res) =>
            res.status === 200 ? Effect.void : Effect.fail(new DevServerNotReady({ url })),
          ),
          Effect.catchTag("HttpClientError", () => Effect.fail(new DevServerNotReady({ url }))),
          Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 120 }),
        );

      return {
        start: Effect.fn(function* ({ fqn, news, invalidate }) {
          const command = news.command ?? "inngest-cli";
          const port = news.port ?? DEFAULT_DEV_SERVER_PORT;
          yield* spawner.string(ChildProcess.make(command, ["version"])).pipe(
            Effect.timeout("10 seconds"),
            Effect.mapError(
              (cause) =>
                new DevServerCommandNotFound({
                  command,
                  message:
                    cause._tag === "PlatformError" && cause.reason._tag === "NotFound"
                      ? `Inngest CLI executable '${command}' was not found. Add the 'inngest-cli' package to your dev dependencies, or set Inngest.DevServer's 'command' to its executable path.`
                      : `Could not run '${command} version': ${cause.message}`,
                  cause,
                }),
            ),
          );
          const [gatewayPort, gatewayGrpcPort, executorGrpcPort] = yield* Effect.all([
            findAvailablePort(),
            findAvailablePort(),
            findAvailablePort(),
          ]);
          const devLog = yield* openDevLog(stage, ...fqn.split(FQN_SEPARATOR));
          yield* Effect.log(`[${fqn}] Logs → ${devLog.path}`);
          const child = yield* spawner.spawn(
            ChildProcess.make(
              command,
              [
                "dev",
                "--no-discovery",
                "--no-poll",
                "--port",
                String(port),
                "--connect-gateway-port",
                String(gatewayPort),
                "--connect-gateway-grpc-port",
                String(gatewayGrpcPort),
                "--connect-executor-grpc-port",
                String(executorGrpcPort),
              ],
              { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
            ),
          );
          let output = "";
          const capture = (stream: typeof child.stdout) =>
            stream.pipe(
              Stream.decodeText,
              Stream.runForEach((text) =>
                Effect.sync(() => {
                  output = (output + text).slice(-4000);
                  devLog.write(text);
                }),
              ),
              Effect.forkScoped,
            );
          yield* capture(child.stdout);
          yield* capture(child.stderr);
          const url = `http://localhost:${port}`;
          yield* Effect.raceAllFirst([
            awaitHealthy(url).pipe(
              Effect.mapError(
                () =>
                  new DevServerExited({
                    command,
                    port,
                    message: `Inngest Dev Server did not become healthy at ${url}/health within 30 seconds. Output:\n${output}`,
                  }),
              ),
            ),
            child.exitCode.pipe(
              Effect.flatMap(
                (exitCode) =>
                  new DevServerExited({
                    command,
                    port,
                    message: `Inngest Dev Server exited with code ${exitCode} before it was healthy. Output:\n${output}`,
                  }),
              ),
            ),
          ]);
          yield* child.exitCode.pipe(Effect.exit, Effect.andThen(invalidate), Effect.forkScoped);
          return { url, inngestDev: url };
        }),
      } satisfies LocalProvider.LocalProviderSpec<DevServer>;
    }),
  );
