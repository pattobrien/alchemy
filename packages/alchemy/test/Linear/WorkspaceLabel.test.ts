import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import { adopt, OwnedBySomeoneElse } from "@/AdoptPolicy";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import { allNoop, createLabel, guard, hasLinearCreds, issueLabel, notFound } from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

test.provider.skipIf(!hasLinearCreds)(
  "creates, updates and deletes a workspace label",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();

      const label = (v2: boolean) =>
        Linear.WorkspaceLabel("Security", {
          name: v2 ? "alc-wl-security-renamed" : "alc-wl-security",
          color: v2 ? "#eb5757" : "#f2994a",
          description: v2 ? "updated" : undefined,
        });

      const v1 = yield* stack.deploy(label(false));
      expect(yield* issueLabel(v1.labelId)).toEqual({
        name: "alc-wl-security",
        color: "#f2994a",
        description: null,
        isGroup: false,
        parentId: null,
        teamId: null,
      });
      expect(allNoop(yield* stack.plan(label(false)))).toBe(true);

      const v2 = yield* stack.deploy(label(true));
      expect(v2.labelId).toBe(v1.labelId);
      expect(yield* issueLabel(v2.labelId)).toMatchObject({
        name: "alc-wl-security-renamed",
        color: "#eb5757",
        description: "updated",
        teamId: null,
      });

      yield* stack.destroy();
      expect(yield* Effect.flip(issueLabel(v2.labelId))).toMatchObject(notFound("IssueLabel"));
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "refuses an existing workspace label without adopt and adopts it with adopt",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const existing = yield* createLabel({ name: "alc-wl-adopt", color: "#0f783c" });

      const label = Linear.WorkspaceLabel("Adopt", {
        name: "alc-wl-adopt",
        description: "adopted",
      });

      const refused = yield* stack.deploy(label).pipe(Effect.flip);
      expect(refused).toBeInstanceOf(OwnedBySomeoneElse);

      const adopted = yield* stack.deploy(label.pipe(adopt(true)));
      expect(adopted.labelId).toBe(existing);
      expect(yield* issueLabel(existing)).toMatchObject({
        name: "alc-wl-adopt",
        color: "#0f783c",
        description: "adopted",
        teamId: null,
      });

      yield* stack.destroy();
      expect(yield* Effect.flip(issueLabel(existing))).toMatchObject(notFound("IssueLabel"));
    }),
  { timeout: 120_000 },
);
