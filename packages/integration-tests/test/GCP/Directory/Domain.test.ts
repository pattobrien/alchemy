import * as GCP from "@alchemy.run/gcp";
import { expect } from "@alchemy.run/test";
import * as directory from "@distilled.cloud/gcp/unstable/admin_directory_v1";
import { adopt } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";
import {
  customer,
  logLevel,
  primaryDomain,
  runLifecycle,
  secondaryDomain,
  waitUntilDomainGone,
} from "./common.ts";

const { test } = Test.make({ providers: GCP.providers() });

test.provider.skipIf(!runLifecycle)(
  "the adopted primary domain survives destroy",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const primary = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* GCP.Directory.Domain("Primary", { domainName: primaryDomain }).pipe(
            adopt(true),
          );
        }),
      );

      expect(primary.domainName).toEqual(primaryDomain);
      expect(primary.customer).toEqual(customer);
      expect(primary.isPrimary).toEqual(true);
      expect(primary.verified).toEqual(true);

      yield* stack.destroy();

      const survivor = yield* directory.getDomains({ customer, domainName: primaryDomain });
      expect(survivor.domainName).toEqual(primaryDomain);
      expect(survivor.isPrimary).toEqual(true);
    }).pipe(logLevel),
  {
    tags: ["provider:gcp", "provider:gcp:directory", "live"],
    timeout: 120_000,
  },
);

test.provider.skipIf(!runLifecycle || secondaryDomain === undefined)(
  "add and remove a secondary domain",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const domainName = secondaryDomain ?? "";
      yield* directory
        .deleteDomains({ customer, domainName })
        .pipe(Effect.catchTag("NotFound", () => Effect.void));

      const added = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* GCP.Directory.Domain("Secondary", { domainName });
        }),
      );

      expect(added.domainName).toEqual(domainName);
      expect(added.isPrimary).toEqual(false);

      const fetched = yield* directory.getDomains({ customer, domainName });
      expect(fetched.domainName).toEqual(domainName);

      yield* stack.destroy();

      const gone = yield* waitUntilDomainGone(domainName);
      expect(gone).toEqual("gone");
    }).pipe(logLevel),
  {
    tags: ["provider:gcp", "provider:gcp:directory", "live"],
    timeout: 120_000,
  },
);
