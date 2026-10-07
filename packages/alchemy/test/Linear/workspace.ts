import { Query } from "@distilled.cloud/core/query";
import {
  Linear,
  type CustomViewCreateInput,
  type IssueLabelCreateInput,
  type WebhookCreateInput,
  type WorkflowStateFilter,
} from "@distilled.cloud/linear";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const hasLinearCreds = !!process.env.LINEAR_API_KEY;

export const scratchKey = "ALC";

export const allNoop = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).every((node) => node.action === "noop");

class WorkspaceMismatch extends Data.TaggedError("WorkspaceMismatch")<{ urlKey: string }> {
  override get message() {
    return `refusing to write to the ${this.urlKey} workspace`;
  }
}

const urlKey = Query.fn(() => Linear.organization().urlKey);

export const guard = Effect.gen(function* () {
  const key = yield* urlKey();
  if (key !== "finedesigns-test") return yield* new WorkspaceMismatch({ urlKey: key });
});

export const team = Query.fn((id: string) =>
  Linear.team({ id }).pipe(
    Query.map((t) => ({
      name: t.name,
      key: t.key,
      triageEnabled: t.triageEnabled,
      defaultIssueStateId: t.defaultIssueState.id,
      defaultTemplateForMembersId: t.defaultTemplateForMembers.id,
    })),
  ),
);

const teamsByKey = Query.fn((key: string) =>
  Linear.teams({ filter: { key: { eq: key } }, first: 1 }).pipe(Query.map((t) => t.id)),
);

export const scratchTeamId = teamsByKey(scratchKey).pipe(
  Effect.map(([id]) => id),
  Effect.flatMap(Effect.fromNullishOr),
);

const readWorkflowState = Query.fn((id: string) =>
  Linear.workflowState({ id }).pipe(
    Query.map((s) => ({
      name: s.name,
      type: s.type,
      color: s.color,
      description: s.description,
      teamId: s.team.id,
      archivedAt: s.archivedAt,
    })),
  ),
);

export const workflowState = (id: string) =>
  readWorkflowState(id).pipe(
    Effect.map(({ archivedAt, ...state }) => ({ ...state, archived: archivedAt !== null })),
  );

export const workflowStates = Query.fn((filter: WorkflowStateFilter) =>
  Linear.workflowStates({ filter, first: 100 }).pipe(Query.map((s) => s.id)),
);

export const archiveState = Query.fn((id: string) => Linear.workflowStateArchive({ id }).success);

const TemplateData = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

const readTemplate = Query.fn((id: string) =>
  Linear.template({ id }).pipe(
    Query.map((t) => ({
      type: t.type,
      name: t.name,
      teamId: t.team.id,
      templateData: t.templateData,
    })),
  ),
);

export const template = Effect.fn("template")(function* (id: string) {
  const t = yield* readTemplate(id);
  return { ...t, templateData: yield* Schema.decodeUnknownEffect(TemplateData)(t.templateData) };
});

export const deleteTemplate = Query.fn((id: string) => Linear.templateDelete({ id }).success);

export const notFound = (entity: string) => ({
  _tag: "LinearNotFound",
  message: `Entity not found: ${entity}`,
});

export const issueLabel = Query.fn((id: string) =>
  Linear.issueLabel({ id }).pipe(
    Query.map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description,
      isGroup: l.isGroup,
      parentId: l.parent.id,
      teamId: l.team.id,
    })),
  ),
);

export const createLabel = Query.fn(
  (input: IssueLabelCreateInput) => Linear.issueLabelCreate({ input }).issueLabel.id,
);

export const deleteLabel = Query.fn((id: string) => Linear.issueLabelDelete({ id }).success);

export const customView = Query.fn((id: string) =>
  Linear.customView({ id }).pipe(
    Query.map((v) => ({
      name: v.name,
      teamId: v.team.id,
      shared: v.shared,
      filterData: v.filterData,
    })),
  ),
);

export const createView = Query.fn(
  (input: CustomViewCreateInput) => Linear.customViewCreate({ input }).customView.id,
);

export const deleteView = Query.fn((id: string) => Linear.customViewDelete({ id }).success);

export const hookUrl = (path: string) => `https://alc.example.com/${path}`;

export const webhook = Query.fn((id: string) =>
  Linear.webhook({ id }).pipe(
    Query.map((h) => ({
      url: h.url,
      label: h.label,
      enabled: h.enabled,
      secret: h.secret,
      resourceTypes: h.resourceTypes,
      teamId: h.team.id,
      allPublicTeams: h.allPublicTeams,
    })),
  ),
);

export const createWebhook = Query.fn(
  (input: WebhookCreateInput) => Linear.webhookCreate({ input }).webhook.id,
);

export const deleteWebhook = Query.fn((id: string) => Linear.webhookDelete({ id }).success);
