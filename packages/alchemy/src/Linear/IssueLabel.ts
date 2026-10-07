import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { deleteLabel, readLabel, reconcileLabel } from "./Label.ts";
import type { Providers } from "./Providers.ts";

export interface IssueLabelProps {
  /**
   * Name of the label. Unique within its team, and a workspace label's name
   * is unique across every team too.
   */
  name: string;

  /**
   * Linear ID of the team the label belongs to. Unset makes it a workspace
   * label. Changing it replaces the label.
   */
  teamId?: string;

  /**
   * Color of the label as a hex code, such as `#bb87fc`. Unset leaves the
   * current color alone, and Linear picks one on create.
   */
  color?: string;

  /**
   * Description of the label. Unset leaves the current description alone.
   */
  description?: string;

  /**
   * Whether the label is a group that other labels nest under. Unset leaves
   * the current setting alone.
   */
  isGroup?: boolean;

  /**
   * Linear ID of the group label this label nests under. Unset leaves the
   * current parent alone.
   */
  parentId?: string;
}

export interface IssueLabelAttributes {
  /**
   * Linear ID of the label.
   */
  labelId: string;
}

export interface IssueLabel extends Resource<
  "Linear.IssueLabel",
  IssueLabelProps,
  IssueLabelAttributes,
  never,
  Providers
> {}

/**
 * A Linear issue label, scoped to one team or to the whole workspace.
 *
 * Use {@link TeamLabel} or {@link WorkspaceLabel} when the scope is fixed.
 * Deleting a label removes it from every issue that carries it. A label that
 * already exists with the same name in the same scope is never taken over
 * silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a Label
 * **Example:** Team Label
 * ```typescript
 * const bug = yield* Linear.IssueLabel("bug", {
 *   name: "Bug",
 *   teamId: team.teamId,
 *   color: "#eb5757",
 * });
 * ```
 *
 * **Example:** Workspace Label
 * ```typescript
 * yield* Linear.IssueLabel("security", {
 *   name: "Security",
 *   description: "Needs a security review",
 * });
 * ```
 *
 * ### Grouping Labels
 * **Example:** Label Group with a Child
 * ```typescript
 * const area = yield* Linear.IssueLabel("area", {
 *   name: "Area",
 *   teamId: team.teamId,
 *   isGroup: true,
 * });
 *
 * yield* Linear.IssueLabel("area-api", {
 *   name: "API",
 *   teamId: team.teamId,
 *   parentId: area.labelId,
 * });
 * ```
 *
 * ### Replacing a Label
 * Changing `teamId` deletes the old label before creating the new one, since
 * a workspace label's name cannot match any team label.
 *
 * **Example:** Promote a Team Label to the Workspace
 * ```typescript
 * yield* Linear.IssueLabel("bug", {
 *   name: "Bug",
 *   color: "#eb5757",
 * });
 * ```
 *
 * @resource
 * @product Linear
 */
export const IssueLabel = Resource<IssueLabel>("Linear.IssueLabel");

export const IssueLabelProvider = () =>
  Provider.succeed(IssueLabel, {
    stables: ["labelId"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && news.teamId !== olds.teamId
          ? { action: "replace" as const, deleteFirst: true }
          : undefined,
      ),

    read: ({ olds, output }) => readLabel(olds, output?.labelId),

    reconcile: ({ news, output }) => reconcileLabel(news, output?.labelId),

    delete: ({ output }) => deleteLabel(output.labelId),
  });
