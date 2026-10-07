import * as InngestApi from "@distilled.cloud/inngest";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { adopt } from "@/AdoptPolicy";
import * as Inngest from "@/Inngest";
import type * as Plan from "@/Plan";
import * as Test from "@/Test/Alchemy";

const { test } = Test.make({ providers: Inngest.providers() });

const hasInngestCreds = !!process.env.INNGEST_API_KEY;

const transform = (event: string) =>
  `function transform(evt, headers, queryParams, raw) { return { name: "${event}", data: evt }; }`;

const respond = `function respond(body, headers) { return { status: 200, headers: {}, body: "ok" }; }`;

const hook = (props: Inngest.WebhookProps) =>
  Effect.gen(function* () {
    const webhook = yield* Inngest.Webhook("Hook", props);
    return { webhook };
  });

const actionOf = (plan: Plan.Plan, logicalId: string) =>
  Object.values(plan.resources).find((node) => node.resource.LogicalId === logicalId)?.action;

const observe = (id: string) =>
  InngestApi.v1.getWebhook({ id }).pipe(
    Effect.map((res) => res.data),
    Effect.catchTag("WebhookNotFound", () => Effect.succeed(undefined)),
  );

const observeFull = (id: string) =>
  InngestApi.listV2Webhooks.items({}).pipe(
    Stream.filter((webhook) => webhook.id === id),
    Stream.runHead,
    Effect.map(Option.getOrUndefined),
  );

test.provider.skipIf(!hasInngestCreds)(
  "a transform or name change updates the webhook in place and destroy deletes it",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(hook({ transform: transform("test/first") }));
      expect(first.webhook.url).toMatch(/^https:\/\/inn\.gs\/e\//);
      expect(first.webhook.transform).toEqual(transform("test/first"));
      const created = yield* observe(first.webhook.id);
      expect(created?.url).toEqual(first.webhook.url);
      expect(created?.name).toEqual(first.webhook.name);

      const stable = yield* stack.plan(hook({ transform: transform("test/first") }));
      expect(actionOf(stable, "Hook")).toBe("noop");

      const changed = yield* stack.plan(
        hook({ name: "alchemy-test-webhook", transform: transform("test/second") }),
      );
      expect(actionOf(changed, "Hook")).toBe("update");

      const second = yield* stack.deploy(
        hook({ name: "alchemy-test-webhook", transform: transform("test/second") }),
      );
      expect(second.webhook.id).toEqual(first.webhook.id);
      expect(second.webhook.url).toEqual(first.webhook.url);
      expect(second.webhook.name).toEqual("alchemy-test-webhook");
      const updated = yield* observe(first.webhook.id);
      expect(updated?.name).toEqual("alchemy-test-webhook");
      expect(updated?.transform).toEqual(transform("test/second"));

      yield* stack.destroy();
      expect(yield* observe(first.webhook.id)).toBeUndefined();
    }),
  { tags: ["provider:inngest", "provider:inngest:webhook", "live"], timeout: 120_000 },
);

test.provider.skipIf(!hasInngestCreds)(
  "a response or event filter change replaces the webhook",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const first = yield* stack.deploy(
        hook({
          transform: transform("test/first"),
          response: respond,
          eventFilter: { events: ["test/*"] },
        }),
      );
      const created = yield* observeFull(first.webhook.id);
      expect(created?.response).toEqual(respond);
      expect(created?.eventFilter?.events).toEqual(["test/*"]);

      const stable = yield* stack.plan(
        hook({
          transform: transform("test/first"),
          response: respond,
          eventFilter: { events: ["test/*"] },
        }),
      );
      expect(actionOf(stable, "Hook")).toBe("noop");

      const second = yield* stack.deploy(
        hook({
          transform: transform("test/first"),
          response: respond,
          eventFilter: { events: ["test/*"], filter: "DENY" },
        }),
      );
      expect(second.webhook.id).not.toEqual(first.webhook.id);
      expect(second.webhook.url).not.toEqual(first.webhook.url);
      expect(yield* observe(first.webhook.id)).toBeUndefined();
      expect((yield* observeFull(second.webhook.id))?.eventFilter?.filter).toEqual("DENY");

      const third = yield* stack.deploy(
        hook({
          transform: transform("test/third"),
          response: respond,
          eventFilter: { events: ["test/*"], filter: "DENY" },
        }),
      );
      expect(third.webhook.id).not.toEqual(second.webhook.id);
      const replaced = yield* observeFull(third.webhook.id);
      expect(replaced?.transform).toEqual(transform("test/third"));
      expect(replaced?.response).toEqual(respond);

      yield* stack.destroy();
      expect(yield* observe(third.webhook.id)).toBeUndefined();
    }),
  { tags: ["provider:inngest", "provider:inngest:webhook", "live"], timeout: 120_000 },
);

test.provider.skipIf(!hasInngestCreds)(
  "an existing webhook with the same name is only adopted with adopt(true)",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const name = "alchemy-test-webhook-adopt";
      const existing = yield* InngestApi.createV2Webhook({
        name,
        transform: transform("test/existing"),
      });
      const existingId = existing.data!.id!;

      const refused = yield* stack
        .deploy(hook({ name, transform: transform("test/existing") }))
        .pipe(Effect.flip);
      expect(String(refused)).toContain("adopt");
      expect((yield* observe(existingId))?.transform).toEqual(transform("test/existing"));

      const adopted = yield* stack.deploy(
        hook({ name, transform: transform("test/adopted") }).pipe(adopt(true)),
      );
      expect(adopted.webhook.id).toEqual(existingId);
      expect((yield* observe(existingId))?.transform).toEqual(transform("test/adopted"));

      yield* stack.destroy();
      expect(yield* observe(existingId)).toBeUndefined();
    }),
  { tags: ["provider:inngest", "provider:inngest:webhook", "live"], timeout: 120_000 },
);
