import * as InngestApi from "@distilled.cloud/inngest";
import { Credentials } from "@distilled.cloud/inngest/Credentials";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
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

const preview = (revision: string) =>
  Effect.gen(function* () {
    const { apiKey } = yield* yield* Credentials;
    const env = yield* Inngest.BranchEnvironment("Preview");
    const worker = yield* Cloudflare.Worker("InngestBranchWorker", {
      main: fixture("app-worker-v1.ts"),
      env: {
        INNGEST_ENV: env.name,
        INNGEST_SIGNING_KEY: apiKey,
        FIXTURE_REVISION: revision,
      },
    });
    const app = yield* Inngest.App("App", {
      main: fixture("app-v1.ts"),
      url: Output.interpolate`${worker.url}/api/inngest`,
      version: worker.hash,
      environment: env.name,
    });
    return { env, app };
  });

const observeEnv = (name: string) =>
  InngestApi.fetchV2AccountEnvs({ xInngestEnv: name }).pipe(
    Effect.map((res) => res.data?.find((env) => env.name === name)),
  );

const findApp = (name: string, archived: boolean) =>
  InngestApi.getV2Apps({ xInngestEnv: name, archived }).pipe(
    Effect.map((res) => res.data?.find((app) => app.id === APP_ID)),
  );

test.provider.skipIf(!hasInngestCreds)(
  "the first sync creates the branch environment and destroy archives it",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(preview("1"));
      const name = first.env.name;

      const created = yield* observeEnv(name);
      expect(created?.isArchived ?? false).toBe(false);

      const app = yield* findApp(name, false);
      expect(app?.functionCount).toEqual(1);
      expect(app?.latestSync?.status).toEqual("success");

      const second = yield* stack.deploy(preview("2"));
      expect(second.env.name).toEqual(name);
      expect(second.app.functions).toEqual(["ping"]);

      yield* stack.destroy();
      expect((yield* observeEnv(name))?.isArchived).toBe(true);
      const archivedApp = yield* findApp(name, true).pipe(
        Effect.repeat({
          schedule: Schedule.spaced("1 second"),
          until: (found) => found !== undefined,
          times: 15,
        }),
      );
      expect(archivedApp?.isArchived).toBe(true);
    }),
  {
    tags: ["provider:inngest", "provider:inngest:branch-environment", "live"],
    timeout: 240_000,
  },
);

test.provider.skipIf(!hasInngestCreds)(
  "deploying into an environment whose app was archived fails loudly",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(preview("1"));
      const name = first.env.name;
      const env = yield* observeEnv(name);
      yield* InngestApi.patchV2Env({ id: env!.id!, xInngestEnv: name, isArchived: true });

      const error = yield* stack.deploy(preview("2")).pipe(Effect.flip);
      expect(String(error)).toContain("is archived");
      expect((yield* observeEnv(name))?.isArchived ?? false).toBe(false);

      yield* stack.destroy();
      expect((yield* observeEnv(name))?.isArchived).toBe(true);
    }),
  {
    tags: ["provider:inngest", "provider:inngest:branch-environment", "live"],
    timeout: 240_000,
  },
);
