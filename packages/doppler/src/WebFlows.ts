import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Page } from "playwright-core";
import {
  DOPPLER_ORIGIN,
  DopplerBrowser,
  DopplerBrowserSignedOut,
  DopplerDashboardRejected,
} from "./Browser.ts";

const ReminderAssigneeType = Schema.Literals(["WorkplaceUser", "Group"]);

export type ReminderAssigneeType = typeof ReminderAssigneeType.Type;

export interface ReminderAssigneeRef {
  readonly type: ReminderAssigneeType;
  readonly slug: string;
}

const ReminderAssignee = Schema.Struct({
  type: ReminderAssigneeType,
  slug: Schema.String,
  name: Schema.String,
});

export type ReminderAssignee = typeof ReminderAssignee.Type;

const Reminder = Schema.Struct({
  id: Schema.String,
  secretName: Schema.String,
  description: Schema.String,
  frequencyDays: Schema.Number,
  nextReminderOn: Schema.String,
  pastDue: Schema.Boolean,
  assignees: Schema.Array(ReminderAssignee),
});

export type LiveReminder = typeof Reminder.Type;

export interface ReminderSettings {
  readonly description: string;
  readonly frequencyDays: number;
  readonly nextReminderOn: string;
  readonly assignees: readonly ReminderAssigneeRef[];
}

const Envelope = Schema.Struct({
  success: Schema.Boolean,
  next: Schema.optional(Schema.String),
  messages: Schema.String.pipe(Schema.Array, Schema.optional),
});

const ConfigPage = Schema.Struct({
  ...Envelope.fields,
  secrets: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ reminder: Reminder.pipe(Schema.NullOr, Schema.optional) }),
    ),
  ),
});

const Upserted = Schema.Struct({ ...Envelope.fields, reminder: Schema.optional(Reminder) });

export interface ReminderLocation {
  readonly workplaceId: string;
  readonly project: string;
  readonly environment: string;
}

const workplaceUrl = (workplaceId: string) => `${DOPPLER_ORIGIN}/workplace/${workplaceId}`;

const configPath = ({ workplaceId, project, environment }: ReminderLocation) =>
  `/workplace/${workplaceId}/projects/${project}/configs/${environment}`;

const reminderPath = ({ workplaceId, project, environment }: ReminderLocation, action: string) =>
  `/workplace/${workplaceId}/projects/${project}/environments/${environment}/reminders/${action}`;

const SIGNED_OUT = /^\/(login|signup|register|sso)(\/|$)/;

const call = (page: Page, path: string, data?: Record<string, unknown>): Promise<unknown> =>
  page.evaluate(
    async ({ path, data }) => {
      const config = (window as unknown as Record<string, unknown>).DOPPLER_CONFIG as
        | { hydrationContext: { csrfToken: string } }
        | undefined;
      if (config === undefined) throw new Error(`No dashboard session on ${location.href}`);
      const response = await fetch(path, {
        method: data === undefined ? "GET" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Requested-With": "XMLHttpRequest",
          "x-doppler-source": "react-dashboard-xhr",
        },
        body:
          data === undefined
            ? undefined
            : JSON.stringify({ ...data, _csrf: config.hydrationContext.csrfToken }),
      });
      const body = (await response.json()) as { csrf?: string };
      if (typeof body.csrf === "string") config.hydrationContext.csrfToken = body.csrf;
      return body;
    },
    { path, data },
  );

const request = <A extends typeof Envelope.Type, I>(
  location: ReminderLocation,
  path: string,
  schema: Schema.Codec<A, I>,
  data?: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const browser = yield* DopplerBrowser;
    const body = yield* browser.page(`${workplaceUrl(location.workplaceId)}/projects`, (page) =>
      call(page, path, data),
    );
    const result = yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError((error) => new DopplerDashboardRejected({ path, messages: [error.message] })),
    );
    if (result.next !== undefined && SIGNED_OUT.test(result.next)) {
      return yield* new DopplerBrowserSignedOut({
        url: `${DOPPLER_ORIGIN}${path}`,
        session: browser.session,
      });
    }
    if (!result.success) {
      return yield* new DopplerDashboardRejected({ path, messages: result.messages ?? [] });
    }
    return result;
  });

const settingsBody = (secret: string, settings: ReminderSettings) => ({
  secretName: secret,
  description: settings.description,
  frequencyDays: String(settings.frequencyDays),
  nextReminderOn: settings.nextReminderOn,
  assignees: settings.assignees.map(({ type, slug }) => ({ type, slug })),
});

const upsert = (
  location: ReminderLocation,
  action: "create" | "update",
  secret: string,
  settings: ReminderSettings,
) =>
  Effect.gen(function* () {
    const path = reminderPath(location, action);
    const result = yield* request(location, path, Upserted, settingsBody(secret, settings));
    if (result.reminder === undefined) {
      return yield* new DopplerDashboardRejected({ path, messages: ["no reminder returned"] });
    }
    return result.reminder;
  });

export const readReminder = (location: ReminderLocation, secret: string) =>
  Effect.map(
    request(location, configPath(location), ConfigPage),
    (result) => result.secrets?.[secret]?.reminder ?? undefined,
  );

export const createReminder = (
  location: ReminderLocation,
  secret: string,
  settings: ReminderSettings,
) => upsert(location, "create", secret, settings);

export const updateReminder = (
  location: ReminderLocation,
  secret: string,
  settings: ReminderSettings,
) => upsert(location, "update", secret, settings);

export const deleteReminder = (location: ReminderLocation, secret: string) =>
  Effect.gen(function* () {
    if ((yield* readReminder(location, secret)) === undefined) return;
    yield* request(location, reminderPath(location, "delete"), Envelope, { secretName: secret });
  });
