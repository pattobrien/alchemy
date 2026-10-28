import { expect } from "@alchemy.run/test";
import { DnsRecord } from "@alchemy.run/vercel/DnsRecord";
import { providers } from "@alchemy.run/vercel/Providers";
import * as dns from "@distilled.cloud/vercel/dns";
import { adopt, OwnedBySomeoneElse } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Result from "effect/Result";

const { test } = Test.make({ providers: providers() });

const logLevel = Effect.provideService(MinimumLogLevel, process.env.DEBUG ? "Debug" : "Info");

const domain = process.env.VERCEL_TEST_DNS_DOMAIN ?? "";

const recordGone = (recordId: string) =>
  dns.getDomainsRecord({ recordId }).pipe(
    Effect.as(false),
    Effect.catchTag("NotFound", () => Effect.succeed(true)),
  );

test.provider.skipIf(!domain)(
  "create, update in place, replace and delete a DNS record",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const program = (props: { name: string; value: string; ttl?: number; comment?: string }) =>
        Effect.gen(function* () {
          return yield* DnsRecord("Record", { domain, type: "TXT", ...props });
        });

      const created = yield* stack.deploy(program({ name: "alchemy-test-record", value: "first" }));
      expect(created.name).toBe("alchemy-test-record");
      expect(created.type).toBe("TXT");
      expect(created.value).toBe("first");
      expect(created.ttl).toBe(60);
      expect(created.comment).toBeNull();

      const updated = yield* stack.deploy(
        program({ name: "alchemy-test-record", value: "second", ttl: 300, comment: "alchemy" }),
      );
      expect(updated.recordId).toBe(created.recordId);
      const live = yield* dns.getDomainsRecord({ recordId: created.recordId });
      expect(live.value).toBe("second");
      expect(live.ttl).toBe(300);
      expect(live.comment).toBe("alchemy");

      const replaced = yield* stack.deploy(
        program({ name: "alchemy-test-record-renamed", value: "second" }),
      );
      expect(replaced.recordId).not.toBe(created.recordId);
      expect(replaced.name).toBe("alchemy-test-record-renamed");
      expect(yield* recordGone(created.recordId)).toBe(true);

      yield* stack.destroy();

      expect(yield* recordGone(replaced.recordId)).toBe(true);
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:dns", "live"], timeout: 120_000 },
);

test.provider.skipIf(!domain)(
  "refuses a matching DNS record until adopted",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const props = {
        domain,
        name: "alchemy-test-foreign",
        type: "TXT",
        value: "foreign",
      } as const;
      const foreign = yield* dns.createRecord(props);

      const program = (adoptIt: boolean) =>
        Effect.gen(function* () {
          return yield* DnsRecord("Foreign", props).pipe(adopt(adoptIt));
        });

      const refused = yield* stack.deploy(program(false)).pipe(Effect.result);
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) expect(refused.failure).toBeInstanceOf(OwnedBySomeoneElse);

      const adopted = yield* stack.deploy(program(true));
      expect(adopted.recordId).toBe(foreign.uid);

      yield* stack.destroy();

      expect(yield* recordGone(adopted.recordId)).toBe(true);
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:dns", "live"], timeout: 120_000 },
);
