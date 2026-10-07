import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { deleteLabel, readLabel, reconcileLabel } from "./Label.ts";
import type { Providers } from "./Providers.ts";

export interface TeamLabelProps {
  /**
   * Name of the label. Unique within the team and across workspace labels.
   */
  name: string;

  /**
   * Linear ID of the team the label belongs to. Changing it replaces the
   * label.
   */
  teamId: string;

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

export interface TeamLabelAttributes {
  /**
   * Linear ID of the label.
   */
  labelId: string;
}

export interface TeamLabel extends Resource<
  "Linear.TeamLabel",
  TeamLabelProps,
  TeamLabelAttributes,
  never,
  Providers
> {}

/**
 * An issue label that belongs to one Linear team.
 *
 * Deleting a label removes it from every issue that carries it. A label that
 * already exists on the team with the same name is never taken over
 * silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a Team Label
 * **Example:** Basic Team Label
 * ```typescript
 * yield* Linear.TeamLabel("bug", {
 *   name: "Bug",
 *   teamId: team.teamId,
 *   color: "#eb5757",
 * });
 * ```
 *
 * ### Grouping Team Labels
 * **Example:** Label Group with Children
 * ```typescript
 * const customer = yield* Linear.TeamLabel("customer", {
 *   name: "Customer",
 *   teamId: team.teamId,
 *   isGroup: true,
 * });
 *
 * yield* Linear.TeamLabel("customer-acme", {
 *   name: "Acme",
 *   teamId: team.teamId,
 *   parentId: customer.labelId,
 * });
 * ```
 *
 * @resource
 * @product Linear
 */
export const TeamLabel = Resource<TeamLabel>("Linear.TeamLabel");

export const TeamLabelProvider = () =>
  Provider.succeed(TeamLabel, {
    stables: ["labelId"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && news.teamId !== olds.teamId
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds, output }) => readLabel(olds, output?.labelId),

    reconcile: ({ news, output }) => reconcileLabel(news, output?.labelId),

    delete: ({ output }) => deleteLabel(output.labelId),
  });
