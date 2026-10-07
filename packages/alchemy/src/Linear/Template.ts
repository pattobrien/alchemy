import { isDeepStrictEqual } from "node:util";
import { Query } from "@distilled.cloud/core/query";
import {
  Linear,
  type Template as LinearTemplate,
  type TemplateCreateInput,
  type TemplateUpdateInput,
} from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { changes, ignoreNotFound, isEmpty } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface TemplateProps {
  /**
   * Kind of entity the template creates, such as `issue` or `project`.
   * Changing it replaces the template.
   */
  type: string;

  /**
   * Name of the template.
   */
  name: string;

  /**
   * Linear ID of the team the template belongs to. Unset makes it a
   * workspace template.
   */
  teamId?: string;

  /**
   * The template's content as a JSON object string, in the shape Linear's
   * `templateData` takes for the template type, such as
   * `{"title":"Bug: ","priority":2}` for an issue.
   */
  templateJson: string;
}

export interface TemplateAttributes {
  /**
   * Linear ID of the template.
   */
  templateId: string;
}

export interface Template extends Resource<
  "Linear.Template",
  TemplateProps,
  TemplateAttributes,
  never,
  Providers
> {}

/**
 * A Linear template that pre-fills new issues, projects or documents.
 *
 * A template that already exists with the same type, name and team is never
 * taken over silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a Template
 * **Example:** Team Issue Template
 * ```typescript
 * const bug = yield* Linear.Template("bug", {
 *   type: "issue",
 *   name: "Bug report",
 *   teamId: team.teamId,
 *   templateJson: JSON.stringify({ title: "Bug: ", priority: 2 }),
 * });
 * ```
 *
 * **Example:** Workspace Issue Template
 * ```typescript
 * yield* Linear.Template("feature", {
 *   type: "issue",
 *   name: "Feature request",
 *   templateJson: JSON.stringify({ title: "Feature: " }),
 * });
 * ```
 *
 * ### Using a Template as a Team Default
 * **Example:** Default Template for Members
 * ```typescript
 * yield* Linear.TeamDefaults("engineering-defaults", {
 *   teamId: team.teamId,
 *   defaultTemplateForMembersId: bug.templateId,
 * });
 * ```
 *
 * @resource
 * @product Linear
 */
export const Template = Resource<Template>("Linear.Template");

const TemplateData = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

const fields = (template: Query<LinearTemplate>) => ({
  id: template.id,
  type: template.type,
  name: template.name,
  teamId: template.team.id,
  templateData: template.templateData,
});

const templates = Query.fn(() => Linear.templates().pipe(Query.map(fields)));
const create = Query.fn((input: TemplateCreateInput) =>
  Linear.templateCreate({ input }).template.pipe(Query.map(fields)),
);
const update = Query.fn(
  (id: string, input: TemplateUpdateInput) => Linear.templateUpdate({ id, input }).success,
);
const remove = Query.fn((id: string) => Linear.templateDelete({ id }).success);

const observe = Effect.fn("observe")(function* (
  props: TemplateProps,
  templateId: string | undefined,
) {
  const all = yield* templates();
  return (
    all.find((template) => template.id === templateId) ??
    all.find(
      (template) =>
        template.type === props.type &&
        template.name === props.name &&
        (template.teamId ?? undefined) === props.teamId,
    )
  );
});

export const TemplateProvider = () =>
  Provider.succeed(Template, {
    stables: ["templateId"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && news.type !== olds.type ? { action: "replace" as const } : undefined,
      ),

    read: ({ olds, output }) =>
      observe(olds, output?.templateId).pipe(
        Effect.map((template) => template && Unowned({ templateId: template.id })),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      const templateData = yield* Schema.decodeEffect(TemplateData)(news.templateJson);
      const template =
        (yield* observe(news, output?.templateId)) ??
        (yield* create({ type: news.type, name: news.name, teamId: news.teamId, templateData }));
      const live = yield* Schema.decodeUnknownEffect(TemplateData)(template.templateData);
      const dataChanged = !(yield* Effect.sync(() => isDeepStrictEqual(live, templateData)));
      const patch = {
        ...changes({ name: template.name, teamId: template.teamId ?? undefined }, news, [
          "name",
          "teamId",
        ]),
        ...(dataChanged ? { templateData } : {}),
      };
      if (!isEmpty(patch)) yield* update(template.id, patch);
      return { templateId: template.id };
    }),

    delete: ({ output }) => ignoreNotFound(remove(output.templateId)),
  });
