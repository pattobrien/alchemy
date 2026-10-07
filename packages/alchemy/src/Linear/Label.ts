import { Query } from "@distilled.cloud/core/query";
import {
  Linear,
  type IssueLabel as LinearIssueLabel,
  type IssueLabelCreateInput,
  type IssueLabelFilter,
  type IssueLabelUpdateInput,
} from "@distilled.cloud/linear";
import * as Effect from "effect/Effect";
import { Unowned } from "../AdoptPolicy.ts";
import { changes, ignoreNotFound, isEmpty } from "./Client.ts";

export interface LabelProps {
  name: string;
  teamId?: string;
  color?: string;
  description?: string;
  isGroup?: boolean;
  parentId?: string;
}

const fields = (label: Query<LinearIssueLabel>) => ({
  id: label.id,
  name: label.name,
  color: label.color,
  description: label.description,
  isGroup: label.isGroup,
  parentId: label.parent.id,
});

const find = Query.fn((filter: IssueLabelFilter) =>
  Linear.issueLabels({ filter, first: 1 }).pipe(Query.map(fields)),
);
const create = Query.fn((input: IssueLabelCreateInput) =>
  Linear.issueLabelCreate({ input }).issueLabel.pipe(Query.map(fields)),
);
const update = Query.fn(
  (id: string, input: IssueLabelUpdateInput) => Linear.issueLabelUpdate({ id, input }).success,
);
const remove = Query.fn((id: string) => Linear.issueLabelDelete({ id }).success);

const observe = Effect.fn("observe")(function* (props: LabelProps, labelId: string | undefined) {
  const [byId] = labelId === undefined ? [] : yield* find({ id: { eq: labelId } });
  return (
    byId ??
    (yield* find({
      name: { eq: props.name },
      team: props.teamId === undefined ? { null: true } : { id: { eq: props.teamId } },
    }))[0]
  );
});

const ensure = (props: LabelProps) =>
  create(props).pipe(
    Effect.catchTag("LinearInvalidInput", (error) =>
      observe(props, undefined).pipe(
        Effect.flatMap((raced) => (raced ? Effect.succeed(raced) : Effect.fail(error))),
      ),
    ),
  );

export const readLabel = (props: LabelProps, labelId: string | undefined) =>
  observe(props, labelId).pipe(Effect.map((label) => label && Unowned({ labelId: label.id })));

export const reconcileLabel = Effect.fn("reconcileLabel")(function* (
  props: LabelProps,
  labelId: string | undefined,
) {
  const label = (yield* observe(props, labelId)) ?? (yield* ensure(props));
  const patch = changes(
    {
      name: label.name,
      color: label.color,
      description: label.description ?? undefined,
      isGroup: label.isGroup,
      parentId: label.parentId ?? undefined,
    },
    props,
    ["name", "color", "description", "isGroup", "parentId"],
  );
  if (!isEmpty(patch)) yield* update(label.id, patch);
  return { labelId: label.id };
});

export const deleteLabel = (labelId: string) => ignoreNotFound(remove(labelId));
