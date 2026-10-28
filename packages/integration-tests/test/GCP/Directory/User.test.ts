import * as GCP from "@alchemy.run/gcp";
import { expect } from "@alchemy.run/test";
import * as directory from "@distilled.cloud/gcp/unstable/admin_directory_v1";
import { adopt } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import {
  deleteUserIfPresent,
  logLevel,
  runLifecycle,
  userEmail,
  waitUntilUserGone,
} from "./common.ts";

const { test } = Test.make({ providers: GCP.providers() });

const password = Redacted.make("Alchemy-Directory-Test-Password-1");

test.provider.skipIf(!runLifecycle)(
  "create, rename, update, and delete a user",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const email = userEmail(`alchemy-dir-user-${stack.stage}`);
      const renamed = userEmail(`alchemy-dir-user-renamed-${stack.stage}`);
      yield* deleteUserIfPresent(email);
      yield* deleteUserIfPresent(renamed);

      const created = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* GCP.Directory.User("Ada", {
            primaryEmail: email,
            givenName: "Ada",
            familyName: "Lovelace",
            password,
            changePasswordAtNextLogin: true,
            includeInGlobalAddressList: false,
          });
        }),
      );

      expect(created.primaryEmail).toEqual(email);
      expect(created.givenName).toEqual("Ada");
      expect(created.familyName).toEqual("Lovelace");
      expect(created.userId.length).toBeGreaterThan(0);
      expect(created.customerId.length).toBeGreaterThan(0);
      expect(created.isAdmin).toEqual(false);

      const fetched = yield* directory.getUsers({ userKey: created.userId });
      expect(fetched.primaryEmail).toEqual(email);
      expect(fetched.includeInGlobalAddressList).toEqual(false);

      const updated = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* GCP.Directory.User("Ada", {
            primaryEmail: renamed,
            givenName: "Ada",
            familyName: "King",
            suspended: true,
          });
        }),
      );

      expect(updated.userId).toEqual(created.userId);
      expect(updated.primaryEmail).toEqual(renamed);
      expect(updated.familyName).toEqual("King");
      expect(updated.suspended).toEqual(true);

      const refetched = yield* directory.getUsers({ userKey: created.userId });
      expect(refetched.primaryEmail).toEqual(renamed);
      expect(refetched.name?.familyName).toEqual("King");
      expect(refetched.suspended).toEqual(true);
      expect(refetched.includeInGlobalAddressList).toEqual(false);

      yield* stack.destroy();

      const gone = yield* waitUntilUserGone(created.userId);
      expect(gone).toEqual("gone");
    }).pipe(logLevel),
  {
    tags: ["provider:gcp", "provider:gcp:directory", "live"],
    timeout: 180_000,
  },
);

test.provider.skipIf(!runLifecycle)(
  "adopt an existing user without changing it",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const email = userEmail(`alchemy-dir-adopt-${stack.stage}`);
      yield* deleteUserIfPresent(email);

      const existing = yield* directory.insertUsers({
        body: {
          primaryEmail: email,
          name: { givenName: "Grace", familyName: "Hopper" },
          password: Redacted.value(password),
        },
      });
      const before = yield* directory.getUsers({ userKey: existing.id ?? email });

      const adopted = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* GCP.Directory.User("Grace", {
            primaryEmail: email,
            givenName: "Grace",
            familyName: "Hopper",
          }).pipe(adopt(true));
        }),
      );

      expect(adopted.userId).toEqual(existing.id);
      expect(adopted.primaryEmail).toEqual(email);

      const after = yield* directory.getUsers({ userKey: adopted.userId });
      expect(after.etag).toEqual(before.etag);

      yield* stack.destroy();

      const gone = yield* waitUntilUserGone(adopted.userId);
      expect(gone).toEqual("gone");
    }).pipe(logLevel),
  {
    tags: ["provider:gcp", "provider:gcp:directory", "live"],
    timeout: 180_000,
  },
);
