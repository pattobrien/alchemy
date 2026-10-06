import * as InngestApi from "@distilled.cloud/inngest";
import { Credentials, fromApiKey } from "@distilled.cloud/inngest/Credentials";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as pathe from "pathe";
import * as Cloudflare from "@/Cloudflare";
import * as Alchemy from "@/index.ts";
import * as Inngest from "@/Inngest";
import * as Output from "@/Output";
import * as Test from "@/Test/Alchemy";
import { findAvailablePort } from "@/Util/Node.ts";
import * as v1 from "./fixtures/app-v1.ts";
import * as v2 from "./fixtures/app-v2.ts";

const { test } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Inngest.providers()),
  dev: true,
});

const hasInngestCreds = !!process.env.INNGEST_API_KEY;

const APP_ID = "alchemy-test-app";

const fixture = (file: string) => pathe.resolve(import.meta.dirname, "fixtures", file);

const modules = { v1, v2 };

const devServer = (port: number) => Inngest.DevServer("InngestDev", { port });

const app = (port: number, version: "v1" | "v2") =>
  Effect.gen(function* () {
    const dev = yield* devServer(port);
    const worker = yield* Cloudflare.Worker("InngestLocalWorker", {
      main: fixture(`app-worker-${version}.ts`),
      env: { INNGEST_DEV: dev.inngestDev },
    });
    const app = yield* Inngest.App("App", {
      client: modules[version].inngest,
      functions: modules[version].functions,
      url: Output.interpolate`${worker.url}/api/inngest`,
      version: worker.hash,
      devServer: dev.url,
    });
    return { dev, worker, app };
  });

const onDevServer = (port: number) =>
  Effect.provide(
    fromApiKey({
      apiKey: Redacted.make("alchemy-dev"),
      apiBaseUrl: `http://localhost:${port}/api/v2`,
    }),
  );

const listFunctions = (port: number) =>
  InngestApi.getV2Functions.items({ appId: APP_ID }).pipe(
    Stream.map((fn) => fn.slug),
    Stream.runCollect,
    Effect.map((slugs) => [...slugs].sort()),
    onDevServer(port),
  );

test.provider(
  "syncs the app into the local Dev Server and removes it on delete",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const port = yield* findAvailablePort();

      const first = yield* stack.deploy(app(port, "v1"));
      expect(first.dev.url).toEqual(`http://localhost:${port}`);
      expect(first.worker.url).toMatch(/^http:\/\/localhost:\d+$/);
      expect(first.app.appId).toEqual(APP_ID);
      expect(first.app.url).toMatch(/^http:\/\/localhost:/);
      expect(first.app.url).toEqual(`${first.worker.url}/api/inngest`);
      expect(first.app.functions).toEqual(["ping"]);
      expect(yield* listFunctions(port)).toEqual(["ping"]);

      const second = yield* stack.deploy(app(port, "v2"));
      expect(second.app.functions).toEqual(["ping", "pong", "pong-failure"]);
      expect(yield* listFunctions(port)).toEqual(["ping", "pong", "pong-failure"]);

      const back = yield* stack.deploy(app(port, "v1"));
      expect(back.app.functions).toEqual(["ping"]);
      expect(yield* listFunctions(port)).toEqual(["ping"]);

      yield* stack.deploy(devServer(port));
      const removed = yield* InngestApi.getV2App({ appId: APP_ID }).pipe(
        onDevServer(port),
        Effect.flip,
      );
      expect(removed._tag).toEqual("AppNotFound");

      yield* stack.destroy();
      const health = yield* HttpClient.get(`http://localhost:${port}/health`).pipe(Effect.flip);
      expect(health._tag).toEqual("HttpClientError");
    }),
  {
    tags: ["provider:inngest", "provider:inngest:app", "local"],
    timeout: 180_000,
  },
);

const remoteApp = Effect.gen(function* () {
  const { apiKey } = yield* yield* Credentials;
  const env = yield* Inngest.BranchEnvironment("RemotePreview");
  const worker = yield* Cloudflare.Worker("InngestRemoteWorker", {
    main: fixture("app-worker-v2.ts"),
    env: {
      INNGEST_ENV: env.name,
      INNGEST_SIGNING_KEY: apiKey,
    },
  }).pipe(Alchemy.remote());
  const app = yield* Inngest.App("RemoteApp", {
    client: v2.inngest,
    functions: v2.functions,
    url: Output.interpolate`${worker.url}/api/inngest`,
    version: worker.hash,
    environment: env.name,
  }).pipe(Alchemy.remote());
  return { env, worker, app };
});

const listCloudFunctions = (environment: string) =>
  InngestApi.getV2Functions.items({ appId: APP_ID, xInngestEnv: environment }).pipe(
    Stream.map((fn) => fn.slug),
    Stream.runCollect,
    Effect.map((slugs) => [...slugs].sort()),
  );

const observeEnv = (name: string) =>
  InngestApi.fetchV2AccountEnvs({ xInngestEnv: name }).pipe(
    Effect.map((res) => res.data?.find((env) => env.name === name)),
  );

test.provider.skipIf(!hasInngestCreds)(
  "Alchemy.remote() syncs the app into Inngest Cloud during dev",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const deployed = yield* stack.deploy(remoteApp);
      const environment = deployed.env.name;
      expect(deployed.worker.url).toMatch(/^https:\/\//);
      expect(deployed.app.url).not.toMatch(/^http:\/\/localhost:/);
      expect(deployed.app.url).toEqual(`${deployed.worker.url}/api/inngest`);
      expect(deployed.app.environment).toEqual(environment);
      expect(deployed.app.functions).toEqual(["ping", "pong", "pong-failure"]);
      expect(yield* listCloudFunctions(environment)).toEqual(["ping", "pong", "pong-failure"]);

      yield* stack.destroy();
      expect((yield* observeEnv(environment))?.isArchived).toBe(true);
    }),
  {
    tags: ["provider:inngest", "provider:inngest:app", "live"],
    timeout: 240_000,
  },
);
