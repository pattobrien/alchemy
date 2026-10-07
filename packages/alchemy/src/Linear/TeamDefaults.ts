import { Query } from "@distilled.cloud/core/query";
import { Linear, type TeamUpdateInput } from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { changes, isEmpty } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface TeamDefaultsProps {
  /**
   * Linear ID of the team whose defaults this sets.
   */
  teamId: string;

  /**
   * Workflow state that new issues in the team start in. Unset leaves the
   * team's current default alone.
   */
  defaultIssueStateId?: string;

  /**
   * Template that team members get by default when they create an issue.
   * Unset leaves the team's current default alone.
   */
  defaultTemplateForMembersId?: string;
}

export interface TeamDefaultsAttributes {
  /**
   * Linear ID of the team.
   */
  teamId: string;

  /**
   * Workflow state that new issues in the team start in.
   */
  defaultIssueStateId: string | undefined;

  /**
   * Template that team members get by default.
   */
  defaultTemplateForMembersId: string | undefined;
}

export interface TeamDefaults extends Resource<
  "Linear.TeamDefaults",
  TeamDefaultsProps,
  TeamDefaultsAttributes,
  never,
  Providers
> {}

/**
 * Settings of a Linear team that point at the team's own workflow states and
 * templates.
 *
 * They live apart from {@link Team} so the team, its states and templates,
 * and these defaults deploy in that order within one plan. A team always has
 * a default state, so removing `TeamDefaults` from the stack leaves the
 * team's settings as they are.
 *
 * ### Setting a Team's Defaults
 * **Example:** Default State Created in the Same Deploy
 * ```typescript
 * const team = yield* Linear.Team("engineering", {
 *   name: "Engineering",
 *   key: "ENG",
 * });
 *
 * const inbox = yield* Linear.WorkflowState("inbox", {
 *   name: "Inbox",
 *   type: "backlog",
 *   color: "#bec2c8",
 *   teamId: team.teamId,
 * });
 *
 * yield* Linear.TeamDefaults("engineering-defaults", {
 *   teamId: team.teamId,
 *   defaultIssueStateId: inbox.stateId,
 * });
 * ```
 *
 * **Example:** Default Template for Members
 * ```typescript
 * const bug = yield* Linear.Template("bug", {
 *   type: "issue",
 *   name: "Bug report",
 *   teamId: team.teamId,
 *   templateJson: JSON.stringify({ title: "Bug: " }),
 * });
 *
 * yield* Linear.TeamDefaults("engineering-defaults", {
 *   teamId: team.teamId,
 *   defaultTemplateForMembersId: bug.templateId,
 * });
 * ```
 *
 * @resource
 * @product Linear
 */
export const TeamDefaults = Resource<TeamDefaults>("Linear.TeamDefaults");

const observe = Query.fn((id: string) =>
  Linear.team({ id }).pipe(
    Query.map((team) => ({
      defaultIssueStateId: team.defaultIssueState.id,
      defaultTemplateForMembersId: team.defaultTemplateForMembers.id,
    })),
  ),
);
const update = Query.fn(
  (id: string, input: TeamUpdateInput) => Linear.teamUpdate({ id, input }).success,
);

const attributes = Effect.fn("attributes")(function* (teamId: string) {
  const team = yield* observe(teamId);
  return {
    teamId,
    defaultIssueStateId: team.defaultIssueStateId ?? undefined,
    defaultTemplateForMembersId: team.defaultTemplateForMembersId ?? undefined,
  };
});

export const TeamDefaultsProvider = () =>
  Provider.succeed(TeamDefaults, {
    read: ({ olds }) =>
      attributes(olds.teamId).pipe(Effect.catchTag("LinearNotFound", () => Effect.undefined)),

    reconcile: Effect.fn(function* ({ news }) {
      const live = yield* attributes(news.teamId);
      const patch = changes(live, news, ["defaultIssueStateId", "defaultTemplateForMembersId"]);
      if (!isEmpty(patch)) yield* update(news.teamId, patch);
      return { ...live, ...patch };
    }),

    delete: () => Effect.void,
  });
