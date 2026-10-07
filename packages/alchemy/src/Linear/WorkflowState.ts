import { Query } from "@distilled.cloud/core/query";
import {
  Linear,
  type WorkflowState as LinearWorkflowState,
  type WorkflowStateCreateInput,
  type WorkflowStateFilter,
  type WorkflowStateUpdateInput,
} from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { changes, ignoreNotFound, isEmpty } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export type WorkflowStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "duplicate";

export interface WorkflowStateProps {
  /**
   * Name of the state. Unique within the team for each state type.
   */
  name: string;

  /**
   * Category the state belongs to, which decides where it sits on the board
   * and how Linear treats its issues. Changing it replaces the state.
   */
  type: WorkflowStateType;

  /**
   * Color of the state as a hex code, such as `#f2c94c`.
   */
  color: string;

  /**
   * Description of the state. Unset leaves the current description alone.
   */
  description?: string;

  /**
   * Linear ID of the team the state belongs to. Changing it replaces the
   * state.
   */
  teamId: string;
}

export interface WorkflowStateAttributes {
  /**
   * Linear ID of the workflow state.
   */
  stateId: string;
}

export interface WorkflowState extends Resource<
  "Linear.WorkflowState",
  WorkflowStateProps,
  WorkflowStateAttributes,
  never,
  Providers
> {}

/**
 * A workflow state on a Linear team's board.
 *
 * Linear has no delete for workflow states, so destroying one archives it. A
 * state that is the team's default or the last of its type cannot be
 * archived: point the team elsewhere with {@link TeamDefaults} first. A state
 * that already exists on the team with the same name is never taken over
 * silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a Workflow State
 * **Example:** Review State
 * ```typescript
 * const review = yield* Linear.WorkflowState("in-review", {
 *   name: "In Review",
 *   type: "started",
 *   color: "#0f783c",
 *   teamId: team.teamId,
 * });
 * ```
 *
 * **Example:** State with a Description
 * ```typescript
 * yield* Linear.WorkflowState("blocked", {
 *   name: "Blocked",
 *   type: "started",
 *   color: "#eb5757",
 *   description: "Waiting on another team",
 *   teamId: team.teamId,
 * });
 * ```
 *
 * ### Replacing a Workflow State
 * Changing `type` or `teamId` archives the old state before creating the new
 * one, since the replacement keeps the same name.
 *
 * **Example:** Move a State to Another Category
 * ```typescript
 * yield* Linear.WorkflowState("blocked", {
 *   name: "Blocked",
 *   type: "unstarted",
 *   color: "#eb5757",
 *   teamId: team.teamId,
 * });
 * ```
 *
 * @resource
 * @product Linear
 */
export const WorkflowState = Resource<WorkflowState>("Linear.WorkflowState");

const fields = (state: Query<LinearWorkflowState>) => ({
  id: state.id,
  name: state.name,
  color: state.color,
  description: state.description,
});

const find = Query.fn((filter: WorkflowStateFilter) =>
  Linear.workflowStates({ filter, first: 1 }).pipe(Query.map(fields)),
);
const create = Query.fn((input: WorkflowStateCreateInput) =>
  Linear.workflowStateCreate({ input }).workflowState.pipe(Query.map(fields)),
);
const update = Query.fn(
  (id: string, input: WorkflowStateUpdateInput) =>
    Linear.workflowStateUpdate({ id, input }).success,
);
const archive = Query.fn((id: string) => Linear.workflowStateArchive({ id }).success);

const observe = Effect.fn("observe")(function* (
  props: WorkflowStateProps,
  stateId: string | undefined,
) {
  const [byId] = stateId === undefined ? [] : yield* find({ id: { eq: stateId } });
  return byId ?? (yield* find({ team: { id: { eq: props.teamId } }, name: { eq: props.name } }))[0];
});

const ensure = (props: WorkflowStateProps) =>
  create(props).pipe(
    Effect.catchTag("LinearInvalidInput", (error) =>
      observe(props, undefined).pipe(
        Effect.flatMap((raced) => (raced ? Effect.succeed(raced) : Effect.fail(error))),
      ),
    ),
  );

export const WorkflowStateProvider = () =>
  Provider.succeed(WorkflowState, {
    stables: ["stateId"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && (news.teamId !== olds.teamId || news.type !== olds.type)
          ? { action: "replace" as const, deleteFirst: true }
          : undefined,
      ),

    read: ({ olds, output }) =>
      observe(olds, output?.stateId).pipe(
        Effect.map((state) => state && Unowned({ stateId: state.id })),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      const state = (yield* observe(news, output?.stateId)) ?? (yield* ensure(news));
      const patch = changes(
        { name: state.name, color: state.color, description: state.description ?? undefined },
        news,
        ["name", "color", "description"],
      );
      if (!isEmpty(patch)) yield* update(state.id, patch);
      return { stateId: state.id };
    }),

    delete: ({ output }) => ignoreNotFound(archive(output.stateId)),
  });
