import { readFile } from "node:fs/promises";
import * as Schema from "effect/Schema";
import type { Page } from "playwright-core";
import { LINEAR_ORIGIN, LinearBrowser } from "./Browser.ts";

const WebhookEventType = Schema.Literals([
  "Comment",
  "CustomerNeed",
  "Customer",
  "Cycle",
  "Document",
  "Reaction",
  "InitiativeUpdate",
  "Initiative",
  "IssueLabel",
  "Attachment",
  "Issue",
  "ProjectLabel",
  "ProjectUpdate",
  "Project",
  "User",
  "IssueSLA",
  "AgentSessionEvent",
  "AppUserNotification",
  "PermissionChange",
  "OAuthAuthorization",
]);

export type WebhookEventType = typeof WebhookEventType.Type;

const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  Comment: "Comments",
  CustomerNeed: "Customer requests",
  Customer: "Customers",
  Cycle: "Cycles",
  Document: "Documents",
  Reaction: "Emoji reactions",
  InitiativeUpdate: "Initiative updates",
  Initiative: "Initiatives",
  IssueLabel: "Issue Labels",
  Attachment: "Issue attachments",
  Issue: "Issues",
  ProjectLabel: "Project Labels",
  ProjectUpdate: "Project updates",
  Project: "Projects",
  User: "Users",
  IssueSLA: "Issue SLA",
  AgentSessionEvent: "Agent session events",
  AppUserNotification: "Inbox notifications",
  PermissionChange: "Permission changes",
  OAuthAuthorization: "OAuth authorization events",
};

export interface OAuthAppSettings {
  readonly name: string;
  readonly developer: string;
  readonly developerUrl?: string;
  readonly description?: string;
  readonly redirectUris: readonly string[];
  readonly clientCredentials?: boolean;
  readonly webhookUrl?: string;
  readonly webhookResourceTypes?: readonly WebhookEventType[];
}

export interface LiveOAuthApp {
  readonly id: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly webhookSecret: string | undefined;
  readonly settings: Required<Omit<OAuthAppSettings, "webhookUrl">> & {
    readonly webhookUrl: string | undefined;
  };
}

const Manifest = Schema.Struct({
  display: Schema.optional(Schema.Struct({ description: Schema.optional(Schema.String) })),
  developer: Schema.Struct({ name: Schema.String }),
  oauth: Schema.Struct({
    client_name: Schema.String,
    client_uri: Schema.optional(Schema.String),
    redirect_uris: Schema.Array(Schema.String),
    grant_types: Schema.Array(Schema.String),
  }),
  webhook: Schema.optional(
    Schema.Struct({
      url: Schema.String,
      resourceTypes: Schema.Array(WebhookEventType),
    }),
  ),
});

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest));

const decodeMutationResult = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
    }),
  ),
);

const committed = async (page: Page, operation: string, submit: () => Promise<void>) => {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/graphql" &&
      (r.request().postData() ?? "").includes(`"operationName":"${operation}"`),
  );
  await submit();
  const { errors } = decodeMutationResult(await (await response).text());
  if (errors !== undefined && errors.length > 0) {
    throw new Error(`Linear rejected ${operation}: ${errors.map((e) => e.message).join("; ")}`);
  }
};

const settingsUrl = (workspace: string) => `${LINEAR_ORIGIN}/${workspace}/settings/api`;
const appUrl = (workspace: string, id: string) => `${settingsUrl(workspace)}/applications/${id}`;

const APP_PATH = /\/settings\/api\/applications\/([0-9a-f-]{36})$/;

const appIdOf = (path: string) => {
  const id = APP_PATH.exec(path)?.[1];
  if (id === undefined) throw new Error(`No OAuth application id in ${path}`);
  return id;
};

const field = {
  name: /^Application name/,
  developer: /^Developer name/,
  developerUrl: /^Developer URL/,
  description: /^Description/,
  redirectUris: /^Redirect URIs/,
  webhookUrl: "Webhook URL",
} as const;

const fillForm = async (page: Page, settings: OAuthAppSettings) => {
  const text = async (label: RegExp | string, value: string | undefined) => {
    if (value !== undefined) await page.getByRole("textbox", { name: label }).fill(value);
  };
  const checkbox = (label: string) => page.getByRole("checkbox", { name: label, exact: true });
  await text(field.name, settings.name);
  await text(field.developer, settings.developer);
  await text(field.developerUrl, settings.developerUrl);
  await text(field.description, settings.description);
  await text(field.redirectUris, settings.redirectUris.join("\n"));
  if (settings.clientCredentials !== undefined) {
    await checkbox("Client credentials").setChecked(settings.clientCredentials);
  }
  if (settings.webhookUrl !== undefined) {
    await checkbox("Webhooks").setChecked(true);
    await text(field.webhookUrl, settings.webhookUrl);
  }
  const types = settings.webhookResourceTypes;
  if (types === undefined) return;
  for (const [type, label] of Object.entries(WEBHOOK_EVENT_LABELS)) {
    await checkbox(label).setChecked(types.some((t) => t === type));
  }
};

const openAppMenu = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: "Open menu" }).first().click();

const synced = (page: Page) => page.waitForLoadState("networkidle");

const appPage = async (page: Page) => {
  const missing = page.getByText("OAuth application not found");
  await synced(page);
  await page.getByRole("main").getByRole("heading", { level: 1 }).or(missing).first().waitFor();
  return !(await missing.isVisible());
};

const copied = async (page: Page, label: string) => {
  const item = page.getByRole("main").getByRole("listitem").filter({ hasText: label });
  if ((await item.count()) === 0) return undefined;
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await item.getByRole("button", { name: "Copy to clipboard" }).click();
  for (let attempt = 0; attempt < 50; attempt++) {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    if (text !== "") return text;
    await page.waitForTimeout(100);
  }
  throw new Error(`Copying the ${label} on ${page.url()} left the clipboard empty`);
};

const readAppPage = async (page: Page, id: string): Promise<LiveOAuthApp | undefined> => {
  if (!(await appPage(page))) return undefined;
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: LINEAR_ORIGIN });
  const clientId = await copied(page, "Client ID");
  const clientSecret = await copied(page, "Client secret");
  if (clientId === undefined || clientSecret === undefined) {
    throw new Error(`No OAuth credentials on ${page.url()}`);
  }
  const webhookSecret = await copied(page, "Signing secret");
  await openAppMenu(page);
  const download = page.waitForEvent("download");
  await page.getByRole("option", { name: "Download manifest" }).click();
  const manifest = decodeManifest(await readFile(await (await download).path(), "utf8"));
  return {
    id,
    clientId,
    clientSecret,
    webhookSecret,
    settings: {
      name: manifest.oauth.client_name,
      developer: manifest.developer.name,
      developerUrl: manifest.oauth.client_uri ?? "",
      description: manifest.display?.description ?? "",
      redirectUris: manifest.oauth.redirect_uris,
      clientCredentials: manifest.oauth.grant_types.includes("client_credentials"),
      webhookUrl: manifest.webhook?.url,
      webhookResourceTypes: manifest.webhook?.resourceTypes ?? [],
    },
  };
};

const onPage = <A>(url: string, f: (page: Page) => Promise<A>) =>
  LinearBrowser.use((browser) => browser.page(url, f));

export const listOAuthApps = (workspace: string) =>
  onPage(settingsUrl(workspace), async (page) => {
    const group = page.getByRole("group", { name: "OAuth applications" });
    await group.getByRole("button", { name: "New OAuth application" }).waitFor();
    await synced(page);
    const edit = page.getByRole("link", { name: "Edit settings" });
    const items = group.getByRole("listitem").filter({ has: edit });
    return Promise.all(
      (await items.all()).map(async (item) => ({
        id: appIdOf((await item.getByRole("link").getAttribute("href")) ?? ""),
        name: (await item.locator("span").first().innerText()).trim(),
      })),
    );
  });

export const readOAuthApp = (workspace: string, id: string) =>
  onPage(appUrl(workspace, id), (page) => readAppPage(page, id));

export const createOAuthApp = (workspace: string, settings: OAuthAppSettings) =>
  onPage(`${settingsUrl(workspace)}/applications/new`, async (page) => {
    await fillForm(page, settings);
    await committed(page, "OauthClientCreate", () =>
      page.getByRole("button", { name: "Create", exact: true }).click(),
    );
    await page.waitForURL((url) => APP_PATH.test(url.pathname));
    const id = appIdOf(new URL(page.url()).pathname);
    const app = await readAppPage(page, id);
    if (app === undefined) throw new Error(`Linear did not show the created application ${id}`);
    return app;
  });

export const updateOAuthApp = (workspace: string, id: string, settings: OAuthAppSettings) =>
  onPage(`${appUrl(workspace, id)}/edit`, async (page) => {
    await fillForm(page, settings);
    await committed(page, "OauthClientUpdate", () =>
      page.getByRole("button", { name: "Save", exact: true }).click(),
    );
  });

export const deleteOAuthApp = (workspace: string, id: string) =>
  onPage(appUrl(workspace, id), async (page) => {
    if (!(await appPage(page))) return;
    await openAppMenu(page);
    await page.getByRole("option", { name: "Delete application" }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "You cannot undo this action" });
    await dialog.getByRole("textbox").fill(await dialog.locator("strong").innerText());
    await committed(page, "OauthClientArchive", () =>
      dialog.getByRole("button", { name: "Delete", exact: true }).click(),
    );
  });
