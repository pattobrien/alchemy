import { isDeepStrictEqual } from "node:util";
import { Query } from "@distilled.cloud/core/query";
import {
  Linear,
  type CustomView as LinearCustomView,
  type CustomViewCreateInput,
  type CustomViewFilter,
  type CustomViewUpdateInput,
  type IssueFilter,
} from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";
import { Unowned } from "../AdoptPolicy.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { changes, ignoreNotFound, isEmpty } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface CustomViewProps {
  /**
   * Name of the view. Views are matched by name within their team, or within
   * the workspace when `teamId` is unset.
   */
  name: string;

  /**
   * Linear ID of the team the view belongs to. Unset makes it a workspace
   * view.
   */
  teamId?: string;

  /**
   * Whether the view is shared with the rest of the workspace. Unset leaves
   * the current setting alone.
   */
  shared?: boolean;

  /**
   * Issue filter the view applies, in the shape of Linear's `IssueFilter`,
   * such as `{ priority: { eq: 1 } }`. Unset leaves the current filter
   * alone.
   */
  filterData?: IssueFilter;
}

export interface CustomViewAttributes {
  /**
   * Linear ID of the view.
   */
  viewId: string;
}

export interface CustomView extends Resource<
  "Linear.CustomView",
  CustomViewProps,
  CustomViewAttributes,
  never,
  Providers
> {}

/**
 * A saved Linear view that filters issues for a team or the whole workspace.
 *
 * A view that already exists with the same name in the same scope is never
 * taken over silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a View
 * **Example:** Shared Team View
 * ```typescript
 * yield* Linear.CustomView("urgent", {
 *   name: "Urgent",
 *   teamId: team.teamId,
 *   shared: true,
 *   filterData: { priority: { eq: 1 } },
 * });
 * ```
 *
 * **Example:** Workspace View
 * ```typescript
 * yield* Linear.CustomView("unassigned", {
 *   name: "Unassigned",
 *   filterData: { assignee: { null: true } },
 * });
 * ```
 *
 * ### Adopting an Existing View
 * Leaving `filterData` unset adopts a view without touching the filter
 * its owner built in the Linear app.
 *
 * **Example:** Manage a View Created in the Linear App
 * ```typescript
 * import { adopt } from "alchemy/AdoptPolicy";
 *
 * yield* Linear.CustomView("triage", {
 *   name: "Triage",
 *   teamId: team.teamId,
 *   shared: true,
 * }).pipe(adopt(true));
 * ```
 *
 * @resource
 * @product Linear
 */
export const CustomView = Resource<CustomView>("Linear.CustomView");

const fields = (view: Query<LinearCustomView>) => ({
  id: view.id,
  name: view.name,
  teamId: view.team.id,
  shared: view.shared,
  filterData: view.filterData,
});

const find = Query.fn((filter: CustomViewFilter) =>
  Linear.customViews({ filter, first: 1 }).pipe(Query.map(fields)),
);
const create = Query.fn((input: CustomViewCreateInput) =>
  Linear.customViewCreate({ input }).customView.pipe(Query.map(fields)),
);
const update = Query.fn(
  (id: string, input: CustomViewUpdateInput) => Linear.customViewUpdate({ id, input }).success,
);
const remove = Query.fn((id: string) => Linear.customViewDelete({ id }).success);

const observe = Effect.fn("observe")(function* (
  props: CustomViewProps,
  viewId: string | undefined,
) {
  const [byId] = viewId === undefined ? [] : yield* find({ id: { eq: viewId } });
  return (
    byId ??
    (yield* find({
      name: { eq: props.name },
      team: props.teamId === undefined ? { null: true } : { id: { eq: props.teamId } },
    }))[0]
  );
});

export const CustomViewProvider = () =>
  Provider.succeed(CustomView, {
    stables: ["viewId"],

    read: ({ olds, output }) =>
      observe(olds, output?.viewId).pipe(
        Effect.map((view) => view && Unowned({ viewId: view.id })),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      const view = (yield* observe(news, output?.viewId)) ?? (yield* create(news));
      const filterUnchanged =
        news.filterData === undefined ||
        (yield* Effect.sync(() => isDeepStrictEqual(view.filterData, news.filterData)));
      const teamId = view.teamId ?? undefined;
      const patch = {
        ...changes({ name: view.name, shared: view.shared }, news, ["name", "shared"]),
        ...(teamId === news.teamId ? {} : { teamId: news.teamId ?? null }),
        ...(filterUnchanged ? {} : { filterData: news.filterData }),
      };
      if (!isEmpty(patch)) yield* update(view.id, patch);
      return { viewId: view.id };
    }),

    delete: ({ output }) => ignoreNotFound(remove(output.viewId)),
  });
