import * as InngestApi from "@distilled.cloud/inngest";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Inngest from "@/Inngest";
import * as Test from "@/Test/Alchemy";

const { test } = Test.make({ providers: Inngest.providers() });

const hasInngestCreds = !!process.env.INNGEST_API_KEY;

const keys = (props: Inngest.SigningKeyProps = {}) =>
  Effect.gen(function* () {
    const signingKey = yield* Inngest.SigningKey("Key", props);
    return { signingKey };
  });

const listed = InngestApi.fetchV2AccountSigningKeys({}).pipe(Effect.map((res) => res.data ?? []));

test.provider.skipIf(!hasInngestCreds)(
  "reads the configured environment's signing key and leaves it in place on destroy",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const expected = (yield* listed)[0]!;
      const first = yield* stack.deploy(keys());
      expect(first.signingKey.id).toEqual(expected.id);
      expect(first.signingKey.environment).toEqual(expected.environment);
      expect(Redacted.value(first.signingKey.key)).toEqual(expected.key);

      yield* stack.destroy();
      expect((yield* listed).map((key) => key.id)).toContain(expected.id);
    }),
  { tags: ["provider:inngest", "provider:inngest:signing-key", "live"], timeout: 120_000 },
);
