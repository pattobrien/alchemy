import * as InngestApi from "@distilled.cloud/inngest";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Inngest from "@/Inngest";
import * as Test from "@/Test/Alchemy";

const { test } = Test.make({ providers: Inngest.providers() });

const hasInngestCreds = !!process.env.INNGEST_API_KEY;

const keys = (props: Inngest.EventKeyProps = {}) =>
  Effect.gen(function* () {
    const eventKey = yield* Inngest.EventKey("Key", props);
    return { eventKey };
  });

const listed = InngestApi.fetchV2AccountEventKeys({}).pipe(Effect.map((res) => res.data ?? []));

test.provider.skipIf(!hasInngestCreds)(
  "reads the configured environment's event key and leaves it in place on destroy",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const expected = (yield* listed)[0]!;
      const first = yield* stack.deploy(keys());
      expect(first.eventKey.id).toEqual(expected.id);
      expect(first.eventKey.name).toEqual(expected.name);
      expect(first.eventKey.environment).toEqual(expected.environment);
      expect(Redacted.value(first.eventKey.key)).toEqual(expected.key);

      const named = yield* stack.deploy(keys({ name: expected.name }));
      expect(named.eventKey.id).toEqual(expected.id);

      const missing = yield* stack
        .deploy(keys({ name: "alchemy-test-missing-key" }))
        .pipe(Effect.flip);
      expect(String(missing)).toContain("alchemy-test-missing-key");

      yield* stack.destroy();
      expect((yield* listed).map((key) => key.id)).toContain(expected.id);
    }),
  { tags: ["provider:inngest", "provider:inngest:event-key", "live"], timeout: 120_000 },
);
