import * as NamespaceLabs from "@alchemy.run/namespacelabs";
import { expect } from "@alchemy.run/test";
import { listProfiles } from "@distilled.cloud/namespacelabs/github_profile";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";

const { test } = Test.make({ providers: NamespaceLabs.providers() });

const hasNamespaceCreds = !!process.env.NSC_TOKEN;

const TAG = "alchemy-it-linux";

const liveByTag = listProfiles({}).pipe(
  Effect.map((response) => response.profiles?.find((profile) => profile.spec?.tag === TAG)),
);

const allNoop = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).every((node) => node.action === "noop");

const profile = (description: string) =>
  Effect.gen(function* () {
    const created = yield* NamespaceLabs.RunnerProfile("Profile", {
      tag: TAG,
      description,
      os: "ubuntu-24.04",
      shape: { virtualCpu: 2, memoryMegabytes: 4096, machineArch: "amd64", os: "linux" },
      builderMode: "USE_REMOTE_BUILDER",
      cacheVolumes: [{ volumeSizeGb: 20, bundledGitMirror: true, allowCommitFromBranch: ["main"] }],
    });
    return {
      profileId: created.profileId,
      runsOn: created.runsOn,
      description: created.description,
      version: created.version,
    };
  });

test.provider.skipIf(!hasNamespaceCreds)(
  "creates a runner profile, updates it in place, plans noop and deletes it",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const v1 = yield* stack.deploy(profile("alchemy integration test"));
      expect(v1.profileId).toMatch(/^ghpf_/);
      expect(v1.runsOn).toBe(`namespace-profile-${TAG}`);
      const live = yield* liveByTag;
      expect(live?.profileId).toBe(v1.profileId);
      expect(live?.spec?.builderMode).toBe("USE_REMOTE_BUILDER");
      expect(live?.spec?.cacheVolumeSettings?.[0]?.volumeSizeGb).toBe(20);

      expect(allNoop(yield* stack.plan(profile("alchemy integration test")))).toBe(true);

      const v2 = yield* stack.deploy(profile("alchemy integration test, updated"));
      expect(v2.profileId).toBe(v1.profileId);
      expect(v2.description).toBe("alchemy integration test, updated");
      expect(Number(v2.version)).toBeGreaterThan(Number(v1.version));

      yield* stack.destroy();
      expect(yield* liveByTag).toBeUndefined();
    }),
  { timeout: 120_000 },
);
