import type { Label } from "@distilled.cloud/namespacelabs/private_devbox";
import { createInternalTags, hasTags } from "alchemy/Tags";
import * as Effect from "effect/Effect";

/**
 * Namespace label names must match `^[a-z]([a-z0-9-.]*[a-z0-9])?$`, so the
 * `alchemy::stack` / `alchemy::stage` / `alchemy::id` ownership tags become
 * `alchemy.stack` / `alchemy.stage` / `alchemy.id`.
 */
export const ALCHEMY_LABEL_PREFIX = "alchemy.";

const TAG_PREFIX = "alchemy::";

export const toLabelName = (tagKey: string): string =>
  tagKey.startsWith(TAG_PREFIX)
    ? `${ALCHEMY_LABEL_PREFIX}${tagKey.slice(TAG_PREFIX.length)}`
    : tagKey;

export const toTagKey = (labelName: string): string =>
  labelName.startsWith(ALCHEMY_LABEL_PREFIX)
    ? `${TAG_PREFIX}${labelName.slice(ALCHEMY_LABEL_PREFIX.length)}`
    : labelName;

export const toLabels = (tags: Record<string, string> | undefined): Label[] =>
  Object.entries(tags ?? {}).map(([name, value]) => ({ name: toLabelName(name), value }));

export const fromLabels = (labels: readonly Label[] | undefined): Record<string, string> =>
  Object.fromEntries(
    (labels ?? [])
      .filter((label) => label.name !== undefined)
      .map((label) => [toTagKey(label.name!), label.value ?? ""]),
  );

export const userLabels = (labels: readonly Label[] | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(fromLabels(labels)).filter(([key]) => !key.startsWith(TAG_PREFIX)),
  );

export const isAlchemyLabelled = (labels: readonly Label[] | undefined): boolean =>
  (labels ?? []).some((label) => label.name === `${ALCHEMY_LABEL_PREFIX}stack`);

export const createInternalLabels = Effect.fn(function* (id: string) {
  return toLabels(yield* createInternalTags(id));
});

export const hasAlchemyLabels = Effect.fn(function* (
  id: string,
  labels: readonly Label[] | undefined,
) {
  return hasTags(yield* createInternalTags(id), fromLabels(labels));
});
