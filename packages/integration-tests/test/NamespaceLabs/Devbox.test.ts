import * as NamespaceLabs from "@alchemy.run/namespacelabs";
import { expect } from "@alchemy.run/test";
import { fetch } from "@distilled.cloud/namespacelabs/private_devbox";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";

const { test } = Test.make({ providers: NamespaceLabs.providers() });

const hasNamespaceCreds = !!process.env.NSC_TOKEN;

const NAME = "alchemy-it-devbox";
const FROM_TEMPLATE = "alchemy-it-devbox-from-template";

const live = (name: string) =>
  fetch({ name }).pipe(
    Effect.map((response) => response.devbox),
    Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
  );

const allNoop = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).every((node) => node.action === "noop");

const SHAPE = { virtualCpu: 2, memoryMegabytes: 4096, machineArch: "amd64", os: "linux" };

const devboxes = (busy: string, volumeSizeGb: number) =>
  Effect.gen(function* () {
    const box = yield* NamespaceLabs.Devbox("Box", {
      name: NAME,
      imageName: "builtin:default",
      shape: SHAPE,
      volumeSizeGb,
      busyEnsureMinimumDuration: busy,
      purpose: "alchemy integration test",
      labels: { team: "platform" },
    });
    const template = yield* NamespaceLabs.DevboxTemplate("Template", {
      name: "alchemy-it-devbox-template",
      instance: { shape: SHAPE, linux: { imageName: "builtin:default" } },
      volumeSizeGb: 10,
      accessMode: "USER_PRIVATE",
    });
    const fromTemplate = yield* NamespaceLabs.Devbox("FromTemplate", {
      name: FROM_TEMPLATE,
      template: template.id,
      purpose: "alchemy integration test (template)",
    });
    return {
      id: box.id,
      busy: box.busyEnsureMinimumDuration,
      volumeSizeGb: box.volumeSizeGb,
      labels: box.labels,
      fromTemplateId: fromTemplate.id,
      fromTemplateShape: fromTemplate.shape,
    };
  });

test.provider.skipIf(!hasNamespaceCreds)(
  "creates devboxes directly and from a template, updates in place, plans noop and expires them",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const v1 = yield* stack.deploy(devboxes("300s", 10));
      expect(v1.id).toBeDefined();
      expect(v1.busy).toBe("300s");
      expect(v1.volumeSizeGb).toBe(10);
      expect(v1.labels).toEqual({ team: "platform" });
      expect(v1.fromTemplateShape?.virtualCpu).toBe(2);
      const created = yield* live(NAME);
      expect(created?.id).toBe(v1.id);
      expect(created?.labels?.some((label) => label.name === "alchemy.stack")).toBe(true);

      expect(allNoop(yield* stack.plan(devboxes("300s", 10)))).toBe(true);

      const v2 = yield* stack.deploy(devboxes("600s", 20));
      expect(v2.id).toBe(v1.id);
      expect(v2.busy).toBe("600s");
      expect(v2.volumeSizeGb).toBe(20);
      expect(v2.fromTemplateId).toBe(v1.fromTemplateId);

      yield* stack.destroy();
      expect((yield* live(NAME))?.destroyedAt ?? "gone").toBeDefined();
      expect((yield* live(FROM_TEMPLATE))?.destroyedAt ?? "gone").toBeDefined();
    }),
  { timeout: 180_000 },
);
