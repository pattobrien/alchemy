import * as directory from "@distilled.cloud/gcp/unstable/admin_directory_v1";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import type { Providers } from "../Providers.ts";
import { normalizeCustomer, sameEmail } from "./internal.ts";

export type UserProps = {
  /**
   * The user's primary email address. Changing it renames the user in
   * place; the previous address stays on the account as an alias. A
   * rename never replaces the user, so the mailbox is kept.
   */
  primaryEmail: string;
  /**
   * The user's first name.
   */
  givenName: string;
  /**
   * The user's last name.
   */
  familyName: string;
  /**
   * Workspace customer id (`C0123abc`) or `my_customer` for the
   * caller's account. Only used to fill the `customerId` attribute when
   * the API omits it; users are addressed by email or id.
   * @default "my_customer"
   */
  customer?: string;
  /**
   * Organizational unit the user belongs to. Left unchanged when
   * omitted; Google places new users in the root unit.
   * @default "/"
   */
  orgUnitPath?: string;
  /**
   * Whether the user is a super administrator. Applied with the
   * `makeAdmin` call when it differs from the live value. Left unchanged
   * when omitted.
   */
  isAdmin?: boolean;
  /**
   * Whether the user is suspended. Left unchanged when omitted.
   */
  suspended?: boolean;
  /**
   * Recovery email of the user. Left unchanged when omitted.
   */
  recoveryEmail?: string;
  /**
   * Recovery phone in E.164 format (`+16506661212`). Left unchanged
   * when omitted.
   */
  recoveryPhone?: string;
  /**
   * Initial password. Google requires it when creating a user. Only
   * sent on create: it is never read back, compared, or updated.
   */
  password?: Redacted.Redacted<string>;
  /**
   * Whether the user must change the password at the next login. Only
   * sent on create.
   */
  changePasswordAtNextLogin?: boolean;
  /**
   * Whether the user's profile is visible in the Global Address List.
   * Left unchanged when omitted.
   */
  includeInGlobalAddressList?: boolean;
};

export type User = Resource<
  "GCP.Directory.User",
  UserProps,
  {
    /** Immutable Directory API user id. */
    userId: string;
    /** The user's primary email address. */
    primaryEmail: string;
    /** The user's first name. */
    givenName: string;
    /** The user's last name. */
    familyName: string;
    /** The user's full name, as formed by Google. */
    fullName: string | undefined;
    /** Workspace customer id the user belongs to. */
    customerId: string;
    /** Organizational unit path. */
    orgUnitPath: string;
    /** Whether the user is a super administrator. */
    isAdmin: boolean;
    /** Whether the user is a delegated administrator. */
    isDelegatedAdmin: boolean;
    /** Whether the user is suspended. */
    suspended: boolean;
    /** Whether the user accepted the Terms of Service. */
    agreedToTerms: boolean;
    /** Whether the user is enrolled in 2-step verification. */
    isEnrolledIn2Sv: boolean;
    /** Whether 2-step verification is enforced for the user. */
    isEnforcedIn2Sv: boolean;
    /** Whether the user's Google mailbox is created. */
    isMailboxSetup: boolean;
    /** Recovery email of the user. */
    recoveryEmail: string | undefined;
    /** Recovery phone of the user. */
    recoveryPhone: string | undefined;
    /** Email aliases of the user. */
    aliases: string[];
    /** RFC3339 creation timestamp. */
    creationTime: string | undefined;
    /** RFC3339 timestamp of the last login. */
    lastLoginTime: string | undefined;
  },
  never,
  Providers
>;

/**
 * A Google Workspace user, managed through the Admin SDK Directory API.
 *
 * The credential must act as a Workspace administrator: a service
 * account with domain-wide delegation for the
 * `admin.directory.user` scope and a delegation subject (see the GCP
 * auth provider's `scopes` and `subject` settings). A rename updates the
 * user in place; nothing about a user is ever replaced. An existing user
 * is reported as unowned until adopted.
 *
 * ### Creating a User
 * **Example:** New user with an initial password
 * ```typescript
 * const user = yield* GCP.Directory.User("Ada", {
 *   primaryEmail: "ada@example.com",
 *   givenName: "Ada",
 *   familyName: "Lovelace",
 *   password: Redacted.make("correct-horse-battery-staple"),
 *   changePasswordAtNextLogin: true,
 * });
 * ```
 *
 * ### Adopting a User
 * **Example:** Take over an existing super administrator
 * ```typescript
 * const admin = yield* GCP.Directory.User("Admin", {
 *   primaryEmail: "admin@example.com",
 *   givenName: "Grace",
 *   familyName: "Hopper",
 *   isAdmin: true,
 * }).pipe(adopt(true));
 * ```
 *
 * @resource
 * @category Directory
 */
export const User = Resource<User>("GCP.Directory.User");

export class UserNotResolved extends Data.TaggedError("GCP.Directory.UserNotResolved")<{
  primaryEmail: string;
}> {}

const toAttrs = (user: directory.User, customer: string | undefined) => ({
  userId: user.id ?? "",
  primaryEmail: user.primaryEmail ?? "",
  givenName: user.name?.givenName ?? "",
  familyName: user.name?.familyName ?? "",
  fullName: user.name?.fullName,
  customerId: user.customerId ?? customer ?? "",
  orgUnitPath: user.orgUnitPath ?? "/",
  isAdmin: user.isAdmin ?? false,
  isDelegatedAdmin: user.isDelegatedAdmin ?? false,
  suspended: user.suspended ?? false,
  agreedToTerms: user.agreedToTerms ?? false,
  isEnrolledIn2Sv: user.isEnrolledIn2Sv ?? false,
  isEnforcedIn2Sv: user.isEnforcedIn2Sv ?? false,
  isMailboxSetup: user.isMailboxSetup ?? false,
  recoveryEmail: user.recoveryEmail,
  recoveryPhone: user.recoveryPhone,
  aliases: [...(user.aliases ?? [])],
  creationTime: user.creationTime,
  lastLoginTime: user.lastLoginTime,
});

const getUser = (userKey: string | undefined) =>
  userKey === undefined || userKey.length === 0
    ? Effect.succeed(undefined)
    : directory
        .getUsers({ userKey })
        .pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined)));

const retryWhilePropagating = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.retry({
      while: (error) => error._tag === "NotFound",
      schedule: Schedule.spaced("2 seconds"),
      times: 10,
    }),
  );

const changedFields = (current: directory.User, news: UserProps): directory.User => {
  const body: directory.User = {};
  if (!sameEmail(current.primaryEmail, news.primaryEmail)) {
    body.primaryEmail = news.primaryEmail;
  }
  if (
    (current.name?.givenName ?? "") !== news.givenName ||
    (current.name?.familyName ?? "") !== news.familyName
  ) {
    body.name = { givenName: news.givenName, familyName: news.familyName };
  }
  if (news.orgUnitPath !== undefined && news.orgUnitPath !== (current.orgUnitPath ?? "/")) {
    body.orgUnitPath = news.orgUnitPath;
  }
  if (news.suspended !== undefined && news.suspended !== (current.suspended ?? false)) {
    body.suspended = news.suspended;
  }
  if (news.recoveryEmail !== undefined && news.recoveryEmail !== (current.recoveryEmail ?? "")) {
    body.recoveryEmail = news.recoveryEmail;
  }
  if (news.recoveryPhone !== undefined && news.recoveryPhone !== (current.recoveryPhone ?? "")) {
    body.recoveryPhone = news.recoveryPhone;
  }
  if (
    news.includeInGlobalAddressList !== undefined &&
    news.includeInGlobalAddressList !== (current.includeInGlobalAddressList ?? true)
  ) {
    body.includeInGlobalAddressList = news.includeInGlobalAddressList;
  }
  return body;
};

const createBody = (news: UserProps): directory.User => ({
  primaryEmail: news.primaryEmail,
  name: { givenName: news.givenName, familyName: news.familyName },
  ...(news.password !== undefined ? { password: Redacted.value(news.password) } : {}),
  ...(news.changePasswordAtNextLogin !== undefined
    ? { changePasswordAtNextLogin: news.changePasswordAtNextLogin }
    : {}),
  ...(news.orgUnitPath !== undefined ? { orgUnitPath: news.orgUnitPath } : {}),
  ...(news.suspended !== undefined ? { suspended: news.suspended } : {}),
  ...(news.recoveryEmail !== undefined ? { recoveryEmail: news.recoveryEmail } : {}),
  ...(news.recoveryPhone !== undefined ? { recoveryPhone: news.recoveryPhone } : {}),
  ...(news.includeInGlobalAddressList !== undefined
    ? { includeInGlobalAddressList: news.includeInGlobalAddressList }
    : {}),
});

const propsChanged = (olds: UserProps, news: UserProps) =>
  !sameEmail(olds.primaryEmail, news.primaryEmail) ||
  olds.givenName !== news.givenName ||
  olds.familyName !== news.familyName ||
  normalizeCustomer(olds.customer) !== normalizeCustomer(news.customer) ||
  olds.orgUnitPath !== news.orgUnitPath ||
  olds.isAdmin !== news.isAdmin ||
  olds.suspended !== news.suspended ||
  olds.recoveryEmail !== news.recoveryEmail ||
  olds.recoveryPhone !== news.recoveryPhone ||
  olds.includeInGlobalAddressList !== news.includeInGlobalAddressList;

export const UserProvider = () =>
  Provider.succeed(User, {
    stables: ["userId", "customerId", "creationTime"],

    diff: Effect.fn(function* ({ news, olds }) {
      if (!isResolved(news)) return undefined;
      if (!propsChanged(olds, news)) return { action: "noop" as const };
      return {
        action: "update" as const,
        stables: ["userId", "customerId", "creationTime"],
      };
    }),

    read: Effect.fn(function* ({ olds, output }) {
      const existing =
        output !== undefined && output.userId.length > 0
          ? yield* getUser(output.userId)
          : yield* getUser(olds?.primaryEmail);
      if (existing === undefined) return undefined;
      const attrs = toAttrs(existing, olds?.customer);
      return output !== undefined ? attrs : Unowned(attrs);
    }),

    reconcile: Effect.fn(function* ({ news, output }) {
      const byId = yield* getUser(output?.userId);
      let current = byId ?? (yield* getUser(news.primaryEmail));

      if (current === undefined) {
        current = yield* directory
          .insertUsers({ body: createBody(news) })
          .pipe(
            Effect.catchTag("Conflict", () =>
              Effect.succeed<directory.User | undefined>(undefined),
            ),
          );
        if (current === undefined) {
          current = yield* getUser(news.primaryEmail);
        }
      }

      if (current === undefined) {
        return yield* new UserNotResolved({ primaryEmail: news.primaryEmail });
      }

      const userKey = current.id ?? news.primaryEmail;

      const patch = changedFields(current, news);
      if (Object.keys(patch).length > 0) {
        current = yield* retryWhilePropagating(directory.updateUsers({ userKey, body: patch }));
      }

      if (news.isAdmin !== undefined && news.isAdmin !== (current.isAdmin ?? false)) {
        yield* retryWhilePropagating(
          directory.makeAdminUsers({ userKey, body: { status: news.isAdmin } }),
        );
        current = { ...current, isAdmin: news.isAdmin };
      }

      return toAttrs(current, news.customer);
    }),

    delete: Effect.fn(function* ({ output }) {
      if (output.userId.length === 0) return;
      yield* directory
        .deleteUsers({ userKey: output.userId })
        .pipe(Effect.catchTag("NotFound", () => Effect.void));
    }),
  });
