import * as Tailscale from "@alchemy.run/tailscale";
import { expect } from "@alchemy.run/test";
import { getPolicyFile } from "@distilled.cloud/tailscale";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";

const { test } = Test.make({ providers: Tailscale.providers() });

const hasTailscaleCreds =
  !!process.env.TAILSCALE_API_KEY || !!process.env.TAILSCALE_OAUTH_CLIENT_ID;
const suffix = crypto.randomUUID().slice(0, 8);

const allNoop = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).every((node) => node.action === "noop");

const live = getPolicyFile({ tailnet: "-" });

const policy = (body: string) =>
  Effect.gen(function* () {
    const applied = yield* Tailscale.Policy("Policy", { body });
    return { body: applied.body, eTag: applied.eTag };
  });

test.provider.skipIf(!hasTailscaleCreds)(
  "writes the policy file, plans noop while unchanged, rejects a broken one and leaves it on destroy",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const original = yield* live;
      const marker = `// probe ${suffix}`;
      const probe = `${original.body.trimEnd()}\n${marker}\n`;

      const v1 = yield* stack.deploy(policy(probe));
      expect(v1.body).toContain(marker);
      expect(v1.eTag).toBeDefined();
      expect(v1.eTag).not.toBe(original.eTag);
      expect((yield* live).eTag).toBe(v1.eTag);
      expect(allNoop(yield* stack.plan(policy(probe)))).toBe(true);
      expect((yield* stack.deploy(policy(probe))).eTag).toBe(v1.eTag);

      const rejected = yield* stack
        .plan(policy('{"grants": [{"src": ["nobody"], "dst": ["*"], "ip": ["*"]}]}'))
        .pipe(Effect.flip);
      expect(String(rejected)).toContain("Tailscale.PolicyRejected");
      expect((yield* live).eTag).toBe(v1.eTag);

      const v2 = yield* stack.deploy(policy(original.body));
      expect(v2.eTag).toBe(original.eTag);

      yield* stack.destroy();
      expect((yield* live).eTag).toBe(original.eTag);
    }),
);
