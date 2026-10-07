import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import {
  allNoop,
  deleteLabel,
  guard,
  hasLinearCreds,
  issueLabel,
  notFound,
  scratchTeamId,
} from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

test.provider.skipIf(!hasLinearCreds)(
  "creates, updates, replaces and deletes issue labels",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const labels = (v2: boolean) =>
        Effect.gen(function* () {
          const area = yield* Linear.IssueLabel("Area", {
            name: "alc-il-area",
            teamId,
            isGroup: true,
          });
          const api = yield* Linear.IssueLabel("Api", {
            name: v2 ? "alc-il-api-renamed" : "alc-il-api",
            teamId,
            parentId: area.labelId,
            color: v2 ? "#4cb782" : "#eb5757",
            description: v2 ? "updated" : undefined,
          });
          const moved = yield* Linear.IssueLabel("Moved", {
            name: "alc-il-moved",
            teamId: v2 ? undefined : teamId,
            color: "#bb87fc",
          });
          return { areaId: area.labelId, apiId: api.labelId, movedId: moved.labelId };
        });

      const v1 = yield* stack.deploy(labels(false));
      expect(yield* issueLabel(v1.areaId)).toEqual({
        name: "alc-il-area",
        color: expect.any(String),
        description: null,
        isGroup: true,
        parentId: null,
        teamId,
      });
      expect(yield* issueLabel(v1.apiId)).toEqual({
        name: "alc-il-api",
        color: "#eb5757",
        description: null,
        isGroup: false,
        parentId: v1.areaId,
        teamId,
      });
      expect(allNoop(yield* stack.plan(labels(false)))).toBe(true);

      const v2 = yield* stack.deploy(labels(true));
      expect(v2.apiId).toBe(v1.apiId);
      expect(v2.movedId).not.toBe(v1.movedId);
      expect(yield* issueLabel(v2.apiId)).toEqual({
        name: "alc-il-api-renamed",
        color: "#4cb782",
        description: "updated",
        isGroup: false,
        parentId: v1.areaId,
        teamId,
      });
      expect(yield* issueLabel(v2.movedId)).toMatchObject({ name: "alc-il-moved", teamId: null });
      expect(yield* Effect.flip(issueLabel(v1.movedId))).toMatchObject(notFound("IssueLabel"));

      yield* stack.destroy();
      for (const id of [v2.areaId, v2.apiId, v2.movedId]) {
        expect(yield* Effect.flip(issueLabel(id))).toMatchObject(notFound("IssueLabel"));
      }
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "destroys a label already deleted outside the stack",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const { labelId } = yield* stack.deploy(
        Linear.IssueLabel("Gone", { name: "alc-il-gone", teamId }),
      );
      yield* deleteLabel(labelId);

      yield* stack.destroy();
      expect(yield* Effect.flip(issueLabel(labelId))).toMatchObject(notFound("IssueLabel"));
    }),
  { timeout: 120_000 },
);
