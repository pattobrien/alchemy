import * as InngestApi from "@distilled.cloud/inngest";
import { Credentials } from "@distilled.cloud/inngest/Credentials";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as pathe from "pathe";
import * as Cloudflare from "@/Cloudflare";
import * as Inngest from "@/Inngest";
import * as Output from "@/Output";
import * as Test from "@/Test/Alchemy";

const { test } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Inngest.providers()),
});

const hasInngestCreds = !!process.env.INNGEST_API_KEY;

const APP_ID = "alchemy-test-app";

const fixture = (file: string) => pathe.resolve(import.meta.dirname, "fixtures", file);

const preview = (version: "v1" | "v2") =>
  Effect.gen(function* () {
    const { apiKey } = yield* yield* Credentials;
    const env = yield* Inngest.BranchEnvironment("Preview");
    const worker = yield* Cloudflare.Worker("InngestAppWorker", {
      main: fixture(`app-worker-${version}.ts`),
      env: {
        INNGEST_ENV: env.name,
        INNGEST_SIGNING_KEY: apiKey,
      },
    });
    const app = yield* Inngest.App("App", {
      main: fixture(`app-${version}.ts`),
      url: Output.interpolate`${worker.url}/api/inngest`,
      version: worker.hash,
      environment: env.name,
    });
    return { env, app };
  });

const listFunctions = (environment: string) =>
  InngestApi.getV2Functions.items({ appId: APP_ID, xInngestEnv: environment }).pipe(
    Stream.map((fn) => fn.slug),
    Stream.runCollect,
    Effect.map((slugs) => [...slugs].sort()),
  );

test.provider.skipIf(!hasInngestCreds)(
  "functions added to and removed from main sync to Inngest",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(preview("v1"));
      const environment = first.env.name;
      expect(first.app.appId).toEqual(APP_ID);
      expect(first.app.functions).toEqual(["ping"]);
      expect(yield* listFunctions(environment)).toEqual(["ping"]);

      const second = yield* stack.deploy(preview("v2"));
      expect(second.app.functions).toEqual(["ping", "pong"]);
      expect(yield* listFunctions(environment)).toEqual(["ping", "pong"]);

      const third = yield* stack.deploy(preview("v1"));
      expect(third.app.functions).toEqual(["ping"]);
      expect(yield* listFunctions(environment)).toEqual(["ping"]);

      yield* stack.destroy();
    }),
  {
    tags: ["provider:inngest", "provider:inngest:app", "live"],
    timeout: 240_000,
  },
);
