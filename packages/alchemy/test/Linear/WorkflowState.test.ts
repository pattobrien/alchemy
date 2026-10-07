import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import { OwnedBySomeoneElse } from "@/AdoptPolicy";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import {
  allNoop,
  archiveState,
  guard,
  hasLinearCreds,
  scratchTeamId,
  workflowState,
} from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

test.provider.skipIf(!hasLinearCreds)(
  "creates, updates, replaces and archives workflow states",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const states = (v2: boolean) =>
        Effect.gen(function* () {
          const review = yield* Linear.WorkflowState("Review", {
            name: v2 ? "alc-ws-review-renamed" : "alc-ws-review",
            type: "started",
            color: v2 ? "#0f783c" : "#f2c94c",
            description: v2 ? "updated" : undefined,
            teamId,
          });
          const moved = yield* Linear.WorkflowState("Moved", {
            name: "alc-ws-moved",
            type: v2 ? "unstarted" : "started",
            color: "#95a2b3",
            teamId,
          });
          return { reviewId: review.stateId, movedId: moved.stateId };
        });

      const v1 = yield* stack.deploy(states(false));
      expect(yield* workflowState(v1.reviewId)).toEqual({
        name: "alc-ws-review",
        type: "started",
        color: "#f2c94c",
        description: null,
        teamId,
        archived: false,
      });
      expect(allNoop(yield* stack.plan(states(false)))).toBe(true);

      const v2 = yield* stack.deploy(states(true));
      expect(v2.reviewId).toBe(v1.reviewId);
      expect(v2.movedId).not.toBe(v1.movedId);
      expect(yield* workflowState(v2.reviewId)).toEqual({
        name: "alc-ws-review-renamed",
        type: "started",
        color: "#0f783c",
        description: "updated",
        teamId,
        archived: false,
      });
      expect(yield* workflowState(v1.movedId)).toMatchObject({ type: "started", archived: true });
      expect(yield* workflowState(v2.movedId)).toMatchObject({
        name: "alc-ws-moved",
        type: "unstarted",
        archived: false,
      });

      yield* stack.destroy();
      expect((yield* workflowState(v2.reviewId)).archived).toBe(true);
      expect((yield* workflowState(v2.movedId)).archived).toBe(true);
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "destroys a state already archived outside the stack",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const { stateId } = yield* stack.deploy(
        Linear.WorkflowState("Gone", {
          name: "alc-ws-gone",
          type: "started",
          color: "#5e6ad2",
          teamId,
        }),
      );
      yield* archiveState(stateId);

      yield* stack.destroy();
      expect((yield* workflowState(stateId)).archived).toBe(true);
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "refuses an existing state without adopt",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const error = yield* stack
        .deploy(
          Linear.WorkflowState("Existing", {
            name: "In Progress",
            type: "started",
            color: "#f2c94c",
            teamId,
          }),
        )
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(OwnedBySomeoneElse);

      yield* stack.destroy();
    }),
  { timeout: 120_000 },
);
