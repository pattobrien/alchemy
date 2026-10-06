import * as InngestApi from "@distilled.cloud/inngest";
import { Credentials } from "@distilled.cloud/inngest/Credentials";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { InngestFunction } from "inngest";
import * as pathe from "pathe";
import * as Cloudflare from "@/Cloudflare";
import * as Inngest from "@/Inngest";
import * as Output from "@/Output";
import type * as Plan from "@/Plan";
import * as Test from "@/Test/Alchemy";
import * as v1Tuned from "./fixtures/app-v1-tuned.ts";
import * as v1 from "./fixtures/app-v1.ts";
import * as v2 from "./fixtures/app-v2.ts";

const { test } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Inngest.providers()),
});

const hasInngestCreds = !!process.env.INNGEST_API_KEY;

const APP_ID = "alchemy-test-app";

const fixture = (file: string) => pathe.resolve(import.meta.dirname, "fixtures", file);

const modules = { v1, v2 };

const preview = (
  version: "v1" | "v2",
  options: { functions?: ReadonlyArray<InngestFunction.Any>; version?: boolean } = {},
) =>
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
      client: modules[version].inngest,
      functions: options.functions ?? modules[version].functions,
      url: Output.interpolate`${worker.url}/api/inngest`,
      version: options.version === false ? undefined : worker.hash,
      environment: env.name,
    });
    return { env, app };
  });

const actionOf = (plan: Plan.Plan, logicalId: string) =>
  Object.values(plan.resources).find((node) => node.resource.LogicalId === logicalId)?.action;

const listFunctions = (environment: string) =>
  InngestApi.getV2Functions.items({ appId: APP_ID, xInngestEnv: environment }).pipe(
    Stream.map((fn) => fn.slug),
    Stream.runCollect,
    Effect.map((slugs) => [...slugs].sort()),
  );

test.provider.skipIf(!hasInngestCreds)(
  "functions added to and removed from the app sync to Inngest",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(preview("v1"));
      const environment = first.env.name;
      expect(first.app.appId).toEqual(APP_ID);
      expect(first.app.functions).toEqual(["ping"]);
      expect(yield* listFunctions(environment)).toEqual(["ping"]);

      const second = yield* stack.deploy(preview("v2"));
      expect(second.app.functions).toEqual(["ping", "pong", "pong-failure"]);
      expect(yield* listFunctions(environment)).toEqual(["ping", "pong", "pong-failure"]);

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

test.provider.skipIf(!hasInngestCreds)(
  "a function config change plans an app update on its own",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(preview("v1"));
      expect(first.app.functions).toEqual(["ping"]);

      const stable = yield* stack.plan(preview("v1"));
      expect(actionOf(stable, "InngestAppWorker")).toBe("noop");
      expect(actionOf(stable, "App")).toBe("noop");

      const tuned = yield* stack.plan(preview("v1", { functions: v1Tuned.functions }));
      expect(actionOf(tuned, "InngestAppWorker")).toBe("noop");
      expect(actionOf(tuned, "App")).toBe("update");

      const unversioned = yield* stack.deploy(
        preview("v1", { functions: v1Tuned.functions, version: false }),
      );
      expect(unversioned.app.functions).toEqual(["ping"]);
      expect(yield* listFunctions(unversioned.env.name)).toEqual(["ping"]);

      const settled = yield* stack.plan(
        preview("v1", { functions: v1Tuned.functions, version: false }),
      );
      expect(actionOf(settled, "App")).toBe("noop");

      yield* stack.destroy();
    }),
  {
    tags: ["provider:inngest", "provider:inngest:app", "live"],
    timeout: 240_000,
  },
);
