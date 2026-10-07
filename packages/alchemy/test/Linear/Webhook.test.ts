import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { adopt, OwnedBySomeoneElse } from "@/AdoptPolicy";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import {
  allNoop,
  createWebhook,
  deleteWebhook,
  guard,
  hasLinearCreds,
  hookUrl,
  notFound,
  scratchTeamId,
  webhook,
} from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

const secrets = {
  v1: "alc-webhook-secret-v1-6f1c2b9e4d7a",
  v2: "alc-webhook-secret-v2-3a8e5c1f9b2d",
};

test.provider.skipIf(!hasLinearCreds)(
  "creates, updates, replaces and deletes webhooks",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const hooks = (v2: boolean) =>
        Effect.gen(function* () {
          const hook = yield* Linear.Webhook("Hook", {
            url: hookUrl(v2 ? "wh-v2" : "wh-v1"),
            resourceTypes: v2 ? ["Comment", "Issue"] : ["Issue"],
            teamId,
            label: v2 ? "alc hook v2" : "alc hook",
            enabled: !v2,
            secret: Redacted.make(v2 ? secrets.v2 : secrets.v1),
          });
          const moved = yield* Linear.Webhook("Moved", {
            url: hookUrl("wh-moved"),
            resourceTypes: ["Issue"],
            teamId: v2 ? undefined : teamId,
          });
          return {
            hookId: hook.webhookId,
            hookUrl: hook.url,
            hookSecret: hook.secret,
            movedId: moved.webhookId,
          };
        });

      const v1 = yield* stack.deploy(hooks(false));
      expect(v1.hookUrl).toBe(hookUrl("wh-v1"));
      expect(v1.hookSecret && Redacted.value(v1.hookSecret)).toBe(secrets.v1);
      expect(yield* webhook(v1.hookId)).toEqual({
        url: hookUrl("wh-v1"),
        label: "alc hook",
        enabled: true,
        secret: secrets.v1,
        resourceTypes: ["Issue"],
        teamId,
        allPublicTeams: false,
      });
      expect(allNoop(yield* stack.plan(hooks(false)))).toBe(true);

      const v2 = yield* stack.deploy(hooks(true));
      expect(v2.hookId).toBe(v1.hookId);
      expect(v2.movedId).not.toBe(v1.movedId);
      expect(v2.hookSecret && Redacted.value(v2.hookSecret)).toBe(secrets.v2);
      const hook = yield* webhook(v2.hookId);
      expect({ ...hook, resourceTypes: hook.resourceTypes.toSorted() }).toEqual({
        url: hookUrl("wh-v2"),
        label: "alc hook v2",
        enabled: false,
        secret: secrets.v2,
        resourceTypes: ["Comment", "Issue"],
        teamId,
        allPublicTeams: false,
      });
      expect(yield* webhook(v2.movedId)).toMatchObject({
        url: hookUrl("wh-moved"),
        teamId: null,
        allPublicTeams: true,
      });
      expect(yield* Effect.flip(webhook(v1.movedId))).toMatchObject(notFound("Webhook"));

      yield* stack.destroy();
      expect(yield* Effect.flip(webhook(v2.hookId))).toMatchObject(notFound("Webhook"));
      expect(yield* Effect.flip(webhook(v2.movedId))).toMatchObject(notFound("Webhook"));
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "exposes the generated secret and destroys a webhook deleted outside the stack",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const { webhookId, secret } = yield* stack.deploy(
        Linear.Webhook("Gone", { url: hookUrl("wh-gone"), resourceTypes: ["Issue"], teamId }),
      );
      const live = yield* webhook(webhookId);
      expect(secret && Redacted.value(secret)).toBe(live.secret);
      expect(live.secret).toMatch(/^lin_wh_/);
      yield* deleteWebhook(webhookId);

      yield* stack.destroy();
      expect(yield* Effect.flip(webhook(webhookId))).toMatchObject(notFound("Webhook"));
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "refuses an existing webhook without adopt and adopts it with adopt",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;
      const existing = yield* createWebhook({
        url: hookUrl("wh-adopt"),
        resourceTypes: ["Issue"],
        teamId,
      });

      const hook = Linear.Webhook("Adopt", {
        url: hookUrl("wh-adopt"),
        resourceTypes: ["Issue"],
        teamId,
        label: "alc adopted",
      });

      const refused = yield* stack.deploy(hook).pipe(Effect.flip);
      expect(refused).toBeInstanceOf(OwnedBySomeoneElse);

      const adopted = yield* stack.deploy(hook.pipe(adopt(true)));
      expect(adopted.webhookId).toBe(existing);
      expect(yield* webhook(existing)).toMatchObject({
        url: hookUrl("wh-adopt"),
        label: "alc adopted",
        teamId,
      });

      yield* stack.destroy();
      expect(yield* Effect.flip(webhook(existing))).toMatchObject(notFound("Webhook"));
    }),
  { timeout: 120_000 },
);
