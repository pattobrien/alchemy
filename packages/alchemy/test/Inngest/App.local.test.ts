import * as InngestApi from "@distilled.cloud/inngest";
import { fromApiKey } from "@distilled.cloud/inngest/Credentials";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as pathe from "pathe";
import * as Cloudflare from "@/Cloudflare";
import * as Inngest from "@/Inngest";
import * as Output from "@/Output";
import * as Test from "@/Test/Alchemy";
import { findAvailablePort } from "@/Util/Node.ts";

const { test } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Inngest.providers()),
  dev: true,
});

const APP_ID = "alchemy-test-app";

const fixture = (file: string) => pathe.resolve(import.meta.dirname, "fixtures", file);

const devServer = (port: number) => Inngest.DevServer("InngestDev", { port });

const app = (port: number, version: "v1" | "v2") =>
  Effect.gen(function* () {
    const dev = yield* devServer(port);
    const worker = yield* Cloudflare.Worker("InngestLocalWorker", {
      main: fixture(`app-worker-${version}.ts`),
      env: { INNGEST_DEV: dev.inngestDev },
    });
    const app = yield* Inngest.App("App", {
      main: fixture(`app-${version}.ts`),
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

      const v1 = yield* stack.deploy(app(port, "v1"));
      expect(v1.dev.url).toEqual(`http://localhost:${port}`);
      expect(v1.worker.url).toMatch(/^http:\/\/localhost:\d+$/);
      expect(v1.app.appId).toEqual(APP_ID);
      expect(v1.app.url).toEqual(`${v1.worker.url}/api/inngest`);
      expect(v1.app.functions).toEqual(["ping"]);
      expect(yield* listFunctions(port)).toEqual(["ping"]);

      const v2 = yield* stack.deploy(app(port, "v2"));
      expect(v2.app.functions).toEqual(["ping", "pong"]);
      expect(yield* listFunctions(port)).toEqual(["ping", "pong"]);

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
