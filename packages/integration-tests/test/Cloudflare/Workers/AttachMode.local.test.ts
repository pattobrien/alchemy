import * as Cloudflare from "@alchemy.run/cloudflare";
import { layerRuntime } from "@alchemy.run/cloudflare-runtime/core";
import { materializeRuntimeBindings } from "@alchemy.run/cloudflare/Workers/RuntimeBindings";
import * as Vite from "@alchemy.run/cloudflare/Workers/Sources/Vite";
import type { ViteChildConfig } from "@alchemy.run/cloudflare/Workers/ViteChild.shared";
import { expect } from "@alchemy.run/test";
import * as Test from "alchemy/Test/Alchemy";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { MinimumLogLevel } from "effect/References";
import * as Schedule from "effect/Schedule";
import * as pathe from "pathe";

const STAGE = "test_attach_mode";
const HOST_URL = "http://localhost:4571";
const FIXTURE = "test/Cloudflare/KV/fixtures/kv-local-worker.ts";

const { test } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: STAGE,
});

const logLevel = Effect.provideService(MinimumLogLevel, process.env.DEBUG ? "Debug" : "Info");

class WorkerNotReady extends Data.TaggedError("WorkerNotReady")<{
  status: number;
}> {}

const getJsonReady = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const res = yield* client.get(url).pipe(
      Effect.flatMap((res) =>
        res.status === 200
          ? Effect.succeed(res)
          : Effect.fail(new WorkerNotReady({ status: res.status })),
      ),
      Effect.retry({
        while: (e): e is WorkerNotReady => e instanceof WorkerNotReady,
        schedule: Schedule.max([
          Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("2 seconds")]),
          Schedule.recurs(10),
        ]),
      }),
    );
    return yield* res.json;
  }).pipe(Effect.orDie);

const attachedWorker = (env: Record<string, unknown>) =>
  Effect.gen(function* () {
    const kv = yield* Cloudflare.KV.Namespace("AttachKV");
    const worker = yield* Cloudflare.Worker("attach-worker", {
      main: pathe.resolve(import.meta.dirname, "../KV/fixtures/kv-local-worker.ts"),
      env: { KV: kv, ...env },
      dev: { mode: "attach", url: HOST_URL },
    });
    return { kv, worker };
  });

/** Runs the Worker from its host config the way `ViteChildRunner` does. */
const hostWorker = (config: ViteChildConfig) =>
  Effect.gen(function* () {
    const context = yield* layerRuntime({
      api: { accountId: Effect.succeed(config.accountId) },
      storage: { directory: config.storageDirectory },
    }).pipe(Layer.build);
    const {
      compatibility,
      main,
      viteEnvironments,
      hasAssets,
      bindingDescriptors,
      devRemote,
      devAccess,
      ...runtimeWorker
    } = config.worker;
    const bindings = yield* materializeRuntimeBindings(
      {
        name: config.worker.name,
        env: config.env,
        hasAssets,
        bindingDescriptors,
        devRemote,
        devAccess,
      },
      { accountId: config.accountId, selfUrl: config.publicUrl, stack: config.stack },
    );
    const server = yield* Vite.viteDev(
      config.rootDir,
      config.env,
      {
        main,
        compatibilityDate: compatibility.date,
        compatibilityFlags: compatibility.flags,
        viteEnvironments,
        worker: { ...runtimeWorker, bindings, publicUrl: config.publicUrl, access: devAccess },
        context,
        entrypoints: [],
      },
      { host: "127.0.0.1", port: 0, strictPort: false },
    );
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) return yield* Effect.die("Vite dev server started without a local URL");
    return url.replace(/\/$/, "");
  });

test.provider(
  "attach mode starts nothing and returns a host config that runs the Worker",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(attachedWorker({ GREETING: "hello-attach" }));

      expect(first.kv.namespaceId).toMatch(/^dev:/);
      expect(first.worker.url).toBe("http://localhost:4571");
      expect(first.worker.urls).toEqual(["http://localhost:4571"]);

      const config = first.worker.hostConfig;
      if (config === undefined) return yield* Effect.die("attach mode returned no hostConfig");
      expect(config.publicUrl).toBe("http://localhost:4571");
      expect(config.worker.main?.endsWith(FIXTURE)).toBe(true);
      expect(config.worker.bindingDescriptors.find((b) => b.name === "KV")).toEqual({
        type: "kv_namespace",
        name: "KV",
        namespaceId: first.kv.namespaceId,
      });
      expect(config.env.GREETING).toBe("hello-attach");
      expect(config.stack.stage).toBe("test_attach_mode");

      const body = yield* Effect.scoped(
        hostWorker(config).pipe(Effect.flatMap((url) => getJsonReady(`${url}/roundtrip`))),
      );
      expect(body).toEqual({
        value: "value1",
        value2: "value2",
        metadata: { hello: "world" },
        keys: ["key1", "key2"],
        afterDelete: null,
      });

      const second = yield* stack.deploy(
        attachedWorker({ GREETING: "hello-attach", SECRET: Redacted.make("shh") }),
      );
      const restarted = second.worker.hostConfig;
      if (restarted === undefined) return yield* Effect.die("restart returned no hostConfig");
      expect(restarted.env.GREETING).toBe("hello-attach");
      const secret = restarted.env.SECRET;
      expect(Redacted.isRedacted(secret) && Redacted.value(secret)).toBe("shh");
      expect(Object.keys(restarted.env).sort()).toEqual(["GREETING", "KV", "SECRET"]);

      yield* stack.destroy();
    }).pipe(logLevel),
  {
    tags: ["provider:cloudflare", "provider:cloudflare:worker", "local"],
    timeout: 180_000,
  },
);
