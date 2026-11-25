import * as directory from "@distilled.cloud/gcp/unstable/admin_directory_v1";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Schedule from "effect/Schedule";

export const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

// The Directory API rejects Cloud Platform tokens. It needs a service
// account with domain-wide delegation for the admin.directory.user and
// admin.directory.domain scopes, minted as a super administrator
// (GOOGLE_OAUTH_SCOPES + GOOGLE_AUTH_SUBJECT). Set GCP_TEST_DIRECTORY=1 and
// GCP_DIRECTORY_DOMAIN to the Workspace primary domain when both hold;
// GCP_DIRECTORY_SECONDARY_DOMAIN additionally enables the add/remove domain
// case.
export const runLifecycle =
  !process.env.FAST && process.env.GCP_TEST_DIRECTORY === "1" && !!process.env.GCP_DIRECTORY_DOMAIN;

export const primaryDomain = process.env.GCP_DIRECTORY_DOMAIN ?? "example.com";
export const secondaryDomain = process.env.GCP_DIRECTORY_SECONDARY_DOMAIN;
export const customer = "my_customer";

export const userEmail = (local: string) => `${local}@${primaryDomain}`;

export const waitUntilUserGone = (userKey: string) =>
  directory.getUsers({ userKey }).pipe(
    Effect.as("found" as const),
    Effect.catchTag("NotFound", () => Effect.succeed("gone" as const)),
    Effect.repeat({
      schedule: Schedule.spaced("2 seconds"),
      until: (status) => status === "gone",
      times: 15,
    }),
  );

export const waitUntilDomainGone = (domainName: string) =>
  directory.getDomains({ customer, domainName }).pipe(
    Effect.as("found" as const),
    Effect.catchTag("NotFound", () => Effect.succeed("gone" as const)),
    Effect.repeat({
      schedule: Schedule.spaced("2 seconds"),
      until: (status) => status === "gone",
      times: 15,
    }),
  );

export const deleteUserIfPresent = (userKey: string) =>
  directory.deleteUsers({ userKey }).pipe(Effect.catchTag("NotFound", () => Effect.void));
