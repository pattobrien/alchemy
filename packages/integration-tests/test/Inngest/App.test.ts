import * as Cloudflare from "@alchemy.run/cloudflare";
import { expect } from "@alchemy.run/test";
import * as InngestApi from "@distilled.cloud/inngest";
import { Credentials } from "@distilled.cloud/inngest/Credentials";
import * as Inngest from "alchemy/Inngest";
import * as Output from "alchemy/Output";
import type * as Plan from "alchemy/Plan";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as pathe from "pathe";

const { test } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Inngest.providers()),
});

const hasInngestCreds = !!process.env.INNGEST_API_KEY;

const APP_ID = "alchemy-test-app";

const fixture = (file: string) => pathe.resolve(import.meta.dirname, "fixtures", file);

const functionIds = { v1: ["ping"], v2: ["ping", "pong", "pong-failure"] };

const preview = (version: "v1" | "v2", options: { functions?: ReadonlyArray<string> } = {}) =>
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
      appId: APP_ID,
      functions: options.functions ?? functionIds[version],
      url: Output.interpolate`${worker.url}/api/inngest`,
      version: worker.hash,
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
  "a function list change plans an app update on its own",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(preview("v1"));
      expect(first.app.functions).toEqual(["ping"]);

      const stable = yield* stack.plan(preview("v1"));
      expect(actionOf(stable, "InngestAppWorker")).toBe("noop");
      expect(actionOf(stable, "App")).toBe("noop");

      const added = yield* stack.plan(preview("v1", { functions: ["ping", "pong"] }));
      expect(actionOf(added, "InngestAppWorker")).toBe("noop");
      expect(actionOf(added, "App")).toBe("update");

      yield* stack.destroy();
    }),
  {
    tags: ["provider:inngest", "provider:inngest:app", "live"],
    timeout: 240_000,
  },
);
