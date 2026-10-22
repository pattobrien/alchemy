import { getWorkplace } from "@distilled.cloud/doppler";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { UserFacingError } from "../UserFacingError.ts";
import { DopplerBrowser } from "./Browser.ts";
import { sameSet } from "./Client.ts";
import type { Providers } from "./Providers.ts";
import {
  createReminder,
  deleteReminder,
  readReminder,
  updateReminder,
  type LiveReminder,
  type ReminderAssigneeType,
  type ReminderLocation,
} from "./WebFlows.ts";

export type SecretReminderAssigneeType = ReminderAssigneeType;

export interface SecretReminderAssignee {
  /**
   * `WorkplaceUser` for a member, `Group` for a group.
   */
  type: SecretReminderAssigneeType;

  /**
   * ID of the workplace user or group, as the Doppler API lists them.
   */
  slug: string;
}

export interface SecretReminderProps {
  /**
   * Slug of the project the secret belongs to.
   */
  project: string;

  /**
   * Slug of the environment the reminder is configured for, such as `prd`.
   * The secret must exist in the environment's root config.
   */
  environment: string;

  /**
   * Secret name, such as `API_KEY`.
   */
  secret: string;

  /**
   * Message included in the reminder email.
   */
  description: string;

  /**
   * Days between reminders, at least 1.
   * @default 30
   */
  frequencyDays?: number;

  /**
   * Date of the next reminder as `YYYY-MM-DD`. Doppler advances it as
   * reminders go out; changing it reschedules the reminder.
   */
  nextReminderOn: string;

  /**
   * Members and groups to remind. Unset or empty reminds everyone with
   * reminder access.
   */
  assignees?: SecretReminderAssignee[];
}

export interface SecretReminderAttributes {
  /**
   * Doppler ID of the reminder.
   */
  reminderId: string;

  /**
   * Slug of the project the secret belongs to.
   */
  project: string;

  /**
   * Slug of the environment the reminder is configured for.
   */
  environment: string;

  /**
   * Secret name.
   */
  secret: string;

  /**
   * Message included in the reminder email.
   */
  description: string;

  /**
   * Days between reminders.
   */
  frequencyDays: number;

  /**
   * Date of the next reminder as `YYYY-MM-DD`.
   */
  nextReminderOn: string;

  /**
   * Whether the reminder is overdue.
   */
  pastDue: boolean;

  /**
   * Members and groups the reminder goes to; empty when it goes to everyone
   * with reminder access.
   */
  assignees: SecretReminderAssignee[];
}

export interface SecretReminder extends Resource<
  "Doppler.SecretReminder",
  SecretReminderProps,
  SecretReminderAttributes,
  never,
  Providers
> {}

/**
 * A recurring reminder to rotate a Doppler secret, emailed every N days to
 * the whole workplace or to chosen members and groups. Doppler keeps one
 * reminder per secret per environment.
 *
 * Doppler's API has no reminder endpoints, so the provider talks to the
 * dashboard's own routes from a browser profile signed in to Doppler once
 * with `alchemy provider doppler browser-login`. Pass `browser` to the
 * providers to enable it. The workplace is the one the providers' token
 * belongs to. A reminder that already exists is never taken over silently:
 * deploy it with `adopt(true)` to manage it.
 *
 * ### Reminding Everyone
 * **Example:** Monthly Rotation Reminder
 * ```typescript
 * const secret = yield* Doppler.Secret("api-key", {
 *   project: "api",
 *   config: "prd",
 *   name: "API_KEY",
 *   value: Redacted.make(apiKey),
 * });
 *
 * yield* Doppler.SecretReminder("api-key-rotation", {
 *   project: secret.project,
 *   environment: "prd",
 *   secret: secret.name,
 *   description: "Rotate the production API key",
 *   frequencyDays: 30,
 *   nextReminderOn: "2027-01-01",
 * });
 * ```
 *
 * ### Reminding Specific Members
 * **Example:** Reminder Assigned to a Group
 * ```typescript
 * yield* Doppler.SecretReminder("api-key-rotation", {
 *   project: "api",
 *   environment: "prd",
 *   secret: "API_KEY",
 *   description: "Rotate the production API key",
 *   frequencyDays: 90,
 *   nextReminderOn: "2027-01-01",
 *   assignees: [{ type: "Group", slug: platformTeam.slug }],
 * });
 * ```
 *
 * ### Enabling the Browser Session
 * **Example:** Providers with a Browser Session
 * ```typescript
 * export default Alchemy.Stack(
 *   "Secrets",
 *   { providers: Doppler.providers({ browser: true }) },
 *   Effect.gen(function* () {
 *     yield* Doppler.SecretReminder("api-key-rotation", {
 *       project: "api",
 *       environment: "prd",
 *       secret: "API_KEY",
 *       description: "Rotate the production API key",
 *       nextReminderOn: "2027-01-01",
 *     });
 *   }),
 * );
 * ```
 *
 * @resource
 * @product Doppler
 */
export const SecretReminder = Resource<SecretReminder>("Doppler.SecretReminder");

export class DopplerSecretReminderNeedsBrowser extends Data.TaggedError(
  "DopplerSecretReminderNeedsBrowser",
)<{}> {
  readonly [UserFacingError] = true;
  override get message(): string {
    return "Doppler has no API for secret reminders, so Doppler.SecretReminder needs a browser session: pass Doppler.providers({ browser: true }) and sign in once with `alchemy provider doppler browser-login`.";
  }
}

const inBrowser = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const browser = yield* Effect.serviceOption(DopplerBrowser);
    if (Option.isNone(browser)) return yield* new DopplerSecretReminderNeedsBrowser();
    return yield* Effect.provideService(effect, DopplerBrowser, browser.value);
  });

const DEFAULT_FREQUENCY_DAYS = 30;

export class DopplerSecretReminderInvalidFrequency extends Data.TaggedError(
  "DopplerSecretReminderInvalidFrequency",
)<{ readonly frequencyDays: number }> {
  readonly [UserFacingError] = true;
  override get message(): string {
    return `Doppler reminders repeat every 1 or more days; got frequencyDays ${this.frequencyDays}.`;
  }
}

const frequencyOf = (news: Pick<SecretReminderProps, "frequencyDays">) => {
  const days = news.frequencyDays ?? DEFAULT_FREQUENCY_DAYS;
  return Number.isInteger(days) && days >= 1
    ? Effect.succeed(days)
    : new DopplerSecretReminderInvalidFrequency({ frequencyDays: days });
};

class DopplerWorkplaceUnknown extends Data.TaggedError("DopplerWorkplaceUnknown")<{}> {
  readonly [UserFacingError] = true;
  override get message(): string {
    return "Doppler returned a workplace without an ID; the token may lack workplace read access.";
  }
}

const locate = (props: Pick<SecretReminderProps, "project" | "environment">) =>
  Effect.flatMap(getWorkplace({}), ({ workplace }) =>
    workplace?.id === undefined
      ? new DopplerWorkplaceUnknown()
      : Effect.succeed<ReminderLocation>({
          workplaceId: workplace.id,
          project: props.project,
          environment: props.environment,
        }),
  );

const assigneeKey = ({ type, slug }: SecretReminderAssignee) => `${type}:${slug}`;

const attributes = (
  props: Pick<SecretReminderProps, "project" | "environment" | "secret">,
  live: LiveReminder,
): SecretReminderAttributes => ({
  reminderId: live.id,
  project: props.project,
  environment: props.environment,
  secret: props.secret,
  description: live.description,
  frequencyDays: live.frequencyDays,
  nextReminderOn: live.nextReminderOn,
  pastDue: live.pastDue,
  assignees: live.assignees.map(({ type, slug }) => ({ type, slug })),
});

export const SecretReminderProvider = () =>
  Provider.succeed(SecretReminder, {
    stables: ["reminderId", "project", "environment", "secret"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) &&
          (news.project !== olds.project ||
            news.environment !== olds.environment ||
            news.secret !== olds.secret)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds }) =>
      inBrowser(
        Effect.gen(function* () {
          const live = yield* readReminder(yield* locate(olds), olds.secret);
          return live && Unowned(attributes(olds, live));
        }),
      ),

    reconcile: ({ news, olds }) =>
      inBrowser(
        Effect.gen(function* () {
          const location = yield* locate(news);
          const live = yield* readReminder(location, news.secret);
          const assignees = news.assignees ?? [];
          const desired = {
            description: news.description,
            frequencyDays: yield* frequencyOf(news),
            nextReminderOn:
              live !== undefined && olds?.nextReminderOn === news.nextReminderOn
                ? live.nextReminderOn
                : news.nextReminderOn,
            assignees,
          };
          if (live === undefined) {
            return attributes(news, yield* createReminder(location, news.secret, desired));
          }
          const drifted =
            live.description !== desired.description ||
            live.frequencyDays !== desired.frequencyDays ||
            live.nextReminderOn !== desired.nextReminderOn ||
            !sameSet(live.assignees.map(assigneeKey), assignees.map(assigneeKey));
          return attributes(
            news,
            drifted ? yield* updateReminder(location, news.secret, desired) : live,
          );
        }),
      ),

    delete: ({ output }) =>
      inBrowser(
        Effect.gen(function* () {
          yield* deleteReminder(yield* locate(output), output.secret);
        }),
      ),
  });
