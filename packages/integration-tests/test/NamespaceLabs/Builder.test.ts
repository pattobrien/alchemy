import * as NamespaceLabs from "@alchemy.run/namespacelabs";
import { expect } from "@alchemy.run/test";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";

const { test } = Test.make({ providers: NamespaceLabs.providers() });

const hasNamespaceCreds = !!process.env.NSC_TOKEN;

const allNoop = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).every((node) => node.action === "noop");

const builder = Effect.gen(function* () {
  const amd64 = yield* NamespaceLabs.Builder("Builder", { platform: "linux/amd64" });
  return {
    instanceId: amd64.instanceId,
    endpoint: amd64.endpoint,
    buildkitEndpoint: amd64.buildkitEndpoint,
    fullBuildkitEndpoint: amd64.fullBuildkitEndpoint,
    deadline: amd64.deadline,
  };
});

test.provider.skipIf(!hasNamespaceCreds)(
  "ensures a builder is running, exposes its endpoints and plans noop",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const ensured = yield* stack.deploy(builder);
      expect(ensured.instanceId).toBeDefined();
      expect(ensured.endpoint).toBeDefined();
      expect(ensured.buildkitEndpoint).toContain("build");
      expect(ensured.fullBuildkitEndpoint).toMatch(/^tcp:\/\//);
      expect(new Date(ensured.deadline!).getTime()).toBeGreaterThan(Date.now());

      expect(allNoop(yield* stack.plan(builder))).toBe(true);

      yield* stack.destroy();
    }),
  { timeout: 120_000 },
);
