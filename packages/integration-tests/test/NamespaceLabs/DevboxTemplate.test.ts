import * as NamespaceLabs from "@alchemy.run/namespacelabs";
import { expect } from "@alchemy.run/test";
import { fetchTemplate } from "@distilled.cloud/namespacelabs/private_devbox";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";

const { test } = Test.make({ providers: NamespaceLabs.providers() });

const hasNamespaceCreds = !!process.env.NSC_TOKEN;

const NAME = "alchemy-it-template";

const live = fetchTemplate({ name: NAME }).pipe(
  Effect.map((response) => response.template),
  Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
);

const allNoop = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).every((node) => node.action === "noop");

const template = (description: string, volumeSizeGb: number) =>
  Effect.gen(function* () {
    const created = yield* NamespaceLabs.DevboxTemplate("Template", {
      name: NAME,
      description,
      instance: {
        shape: { virtualCpu: 2, memoryMegabytes: 4096, machineArch: "amd64", os: "linux" },
        linux: { imageName: "builtin:default" },
      },
      volumeSizeGb,
      accessMode: "USER_PRIVATE",
      busyEnsureMinimumDuration: "300s",
    });
    return {
      id: created.id,
      description: created.description,
      volumeSizeGb: created.volumeSizeGb,
      version: created.version,
    };
  });

test.provider.skipIf(!hasNamespaceCreds)(
  "creates a devbox template, updates it in place, plans noop and expires it",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const v1 = yield* stack.deploy(template("alchemy integration test", 10));
      expect(v1.id).toBeDefined();
      expect(v1.volumeSizeGb).toBe(10);
      expect((yield* live)?.id).toBe(v1.id);

      expect(allNoop(yield* stack.plan(template("alchemy integration test", 10)))).toBe(true);

      const v2 = yield* stack.deploy(template("alchemy integration test, updated", 20));
      expect(v2.id).toBe(v1.id);
      expect(v2.description).toBe("alchemy integration test, updated");
      expect(v2.volumeSizeGb).toBe(20);
      expect((yield* live)?.spec?.volumeSizeGb).toBe("20");

      yield* stack.destroy();
      expect(yield* live).toBeUndefined();
    }),
  { timeout: 120_000 },
);
