import * as Schema from "effect/Schema";
import type { Page } from "playwright-core";
import {
  DOPPLER_ORIGIN,
  DopplerBrowser,
  DopplerDashboardRejected,
  SessionLost,
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
  messages: Schema.optional(Schema.Array(Schema.String)),
});

const ConfigPage = Schema.Struct({
  ...Envelope.fields,
  secrets: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ reminder: Schema.optional(Schema.NullOr(Reminder)) }),
    ),
  ),
});

const Upserted = Schema.Struct({ ...Envelope.fields, reminder: Schema.optional(Reminder) });

const decodeConfigPage = Schema.decodeUnknownSync(ConfigPage);
const decodeUpserted = Schema.decodeUnknownSync(Upserted);
const decodeEnvelope = Schema.decodeUnknownSync(Envelope);

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

const checked =
  <A extends typeof Envelope.Type>(path: string, decode: (u: unknown) => A) =>
  (body: unknown): A => {
    const result = decode(body);
    if (result.next !== undefined && SIGNED_OUT.test(result.next)) throw new SessionLost(path);
    if (!result.success) {
      throw new DopplerDashboardRejected({ path, messages: result.messages ?? [] });
    }
    return result;
  };

const onPage = <A>(url: string, f: (page: Page) => Promise<A>) =>
  DopplerBrowser.use((browser) => browser.page(url, f));

const settingsBody = (secret: string, settings: ReminderSettings) => ({
  secretName: secret,
  description: settings.description,
  frequencyDays: String(settings.frequencyDays),
  nextReminderOn: settings.nextReminderOn,
  assignees: settings.assignees.map(({ type, slug }) => ({ type, slug })),
});

const readOn = async (page: Page, location: ReminderLocation, secret: string) => {
  const path = configPath(location);
  const result = checked(path, decodeConfigPage)(await call(page, path));
  return result.secrets?.[secret]?.reminder ?? undefined;
};

export const readReminder = (location: ReminderLocation, secret: string) =>
  onPage(`${workplaceUrl(location.workplaceId)}/projects`, (page) =>
    readOn(page, location, secret),
  );

export const createReminder = (
  location: ReminderLocation,
  secret: string,
  settings: ReminderSettings,
) =>
  onPage(`${workplaceUrl(location.workplaceId)}/projects`, async (page) => {
    const path = reminderPath(location, "create");
    const result = checked(
      path,
      decodeUpserted,
    )(await call(page, path, settingsBody(secret, settings)));
    if (result.reminder === undefined) throw new Error(`Doppler returned no reminder from ${path}`);
    return result.reminder;
  });

export const updateReminder = (
  location: ReminderLocation,
  secret: string,
  settings: ReminderSettings,
) =>
  onPage(`${workplaceUrl(location.workplaceId)}/projects`, async (page) => {
    const path = reminderPath(location, "update");
    const result = checked(
      path,
      decodeUpserted,
    )(await call(page, path, settingsBody(secret, settings)));
    if (result.reminder === undefined) throw new Error(`Doppler returned no reminder from ${path}`);
    return result.reminder;
  });

export const deleteReminder = (location: ReminderLocation, secret: string) =>
  onPage(`${workplaceUrl(location.workplaceId)}/projects`, async (page) => {
    if ((await readOn(page, location, secret)) === undefined) return;
    const path = reminderPath(location, "delete");
    checked(path, decodeEnvelope)(await call(page, path, { secretName: secret }));
  });
