import { Query } from "@distilled.cloud/core/query";
import {
  Linear,
  type Team as LinearTeam,
  type TeamCreateInput,
  type TeamFilter,
  type TeamUpdateInput,
} from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { changes, ignoreNotFound, isEmpty } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface TeamProps {
  /**
   * Display name of the team.
   */
  name: string;

  /**
   * Short identifier prefixed to the team's issue identifiers, such as `ENG`
   * in `ENG-123`. Unique across the workspace. Changing it renames the team's
   * issue identifiers in place.
   */
  key: string;

  /**
   * Whether new issues from integrations and other teams land in a Triage
   * state first. Unset leaves the team's current setting alone.
   */
  triageEnabled?: boolean;
}

export interface TeamAttributes {
  /**
   * Linear ID of the team.
   */
  teamId: string;
}

export interface Team extends Resource<
  "Linear.Team",
  TeamProps,
  TeamAttributes,
  never,
  Providers
> {}

/**
 * A Linear team.
 *
 * Deleting a Linear team deletes its issues, so removing a `Team` from the
 * stack retains the team in Linear and only forgets it. A team that already
 * exists with the same key is never taken over silently: deploy it with
 * `adopt(true)` to manage it.
 *
 * ### Creating a Team
 * **Example:** Basic Team
 * ```typescript
 * const team = yield* Linear.Team("engineering", {
 *   name: "Engineering",
 *   key: "ENG",
 * });
 * ```
 *
 * **Example:** Team with Triage
 * ```typescript
 * const team = yield* Linear.Team("support", {
 *   name: "Support",
 *   key: "SUP",
 *   triageEnabled: true,
 * });
 * ```
 *
 * ### Adopting an Existing Team
 * **Example:** Manage a Team Created in the Linear App
 * ```typescript
 * import { adopt } from "alchemy/AdoptPolicy";
 *
 * const team = yield* Linear.Team("engineering", {
 *   name: "Engineering",
 *   key: "ENG",
 * }).pipe(adopt(true));
 * ```
 *
 * ### Wiring Team Resources
 * **Example:** Workflow State on a Team
 * ```typescript
 * const team = yield* Linear.Team("engineering", {
 *   name: "Engineering",
 *   key: "ENG",
 * });
 *
 * yield* Linear.WorkflowState("in-review", {
 *   name: "In Review",
 *   type: "started",
 *   color: "#0f783c",
 *   teamId: team.teamId,
 * });
 * ```
 *
 * @resource
 * @product Linear
 */
export const Team = Resource<Team>("Linear.Team", { defaultRemovalPolicy: "retain" });

const fields = (team: Query<LinearTeam>) => ({
  id: team.id,
  name: team.name,
  key: team.key,
  triageEnabled: team.triageEnabled,
});

const find = Query.fn((filter: TeamFilter) =>
  Linear.teams({ filter, first: 1 }).pipe(Query.map(fields)),
);
const create = Query.fn((input: TeamCreateInput) =>
  Linear.teamCreate({ input }).team.pipe(Query.map(fields)),
);
const update = Query.fn(
  (id: string, input: TeamUpdateInput) => Linear.teamUpdate({ id, input }).success,
);
const remove = Query.fn((id: string) => Linear.teamDelete({ id }).success);

const observe = Effect.fn("observe")(function* (props: TeamProps, teamId: string | undefined) {
  const [byId] = teamId === undefined ? [] : yield* find({ id: { eq: teamId } });
  return byId ?? (yield* find({ key: { eq: props.key } }))[0];
});

const managed = ["name", "key", "triageEnabled"] as const;

export const TeamProvider = () =>
  Provider.succeed(Team, {
    stables: ["teamId"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && managed.some((key) => news[key] !== olds[key])
          ? { action: "update" as const, stables: ["teamId"] }
          : undefined,
      ),

    read: ({ olds, output }) =>
      observe(olds, output?.teamId).pipe(
        Effect.map((team) => team && Unowned({ teamId: team.id })),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      const team =
        (yield* observe(news, output?.teamId)) ??
        (yield* create({ name: news.name, key: news.key, triageEnabled: news.triageEnabled }).pipe(
          Effect.flatMap(Effect.fromNullishOr),
        ));
      const patch = changes(team, news, managed);
      if (!isEmpty(patch)) yield* update(team.id, patch);
      return { teamId: team.id };
    }),

    delete: ({ output }) => ignoreNotFound(remove(output.teamId)),
  });
