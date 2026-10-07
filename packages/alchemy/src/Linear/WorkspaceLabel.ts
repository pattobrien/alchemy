import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { deleteLabel, readLabel, reconcileLabel } from "./Label.ts";
import type { Providers } from "./Providers.ts";

export interface WorkspaceLabelProps {
  /**
   * Name of the label. Unique across the workspace, including every team's
   * labels.
   */
  name: string;

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
   * Linear ID of the workspace group label this label nests under. Unset
   * leaves the current parent alone.
   */
  parentId?: string;
}

export interface WorkspaceLabelAttributes {
  /**
   * Linear ID of the label.
   */
  labelId: string;
}

export interface WorkspaceLabel extends Resource<
  "Linear.WorkspaceLabel",
  WorkspaceLabelProps,
  WorkspaceLabelAttributes,
  never,
  Providers
> {}

/**
 * An issue label available to every team in the Linear workspace.
 *
 * Deleting a label removes it from every issue that carries it. A workspace
 * label that already exists with the same name is never taken over silently:
 * deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a Workspace Label
 * **Example:** Basic Workspace Label
 * ```typescript
 * yield* Linear.WorkspaceLabel("security", {
 *   name: "Security",
 *   color: "#eb5757",
 *   description: "Needs a security review",
 * });
 * ```
 *
 * ### Adopting an Existing Label
 * **Example:** Manage a Label Created in the Linear App
 * ```typescript
 * import { adopt } from "alchemy/AdoptPolicy";
 *
 * yield* Linear.WorkspaceLabel("security", {
 *   name: "Security",
 * }).pipe(adopt(true));
 * ```
 *
 * @resource
 * @product Linear
 */
export const WorkspaceLabel = Resource<WorkspaceLabel>("Linear.WorkspaceLabel");

export const WorkspaceLabelProvider = () =>
  Provider.succeed(WorkspaceLabel, {
    stables: ["labelId"],

    read: ({ olds, output }) => readLabel(olds, output?.labelId),

    reconcile: ({ news, output }) => reconcileLabel(news, output?.labelId),

    delete: ({ output }) => deleteLabel(output.labelId),
  });
