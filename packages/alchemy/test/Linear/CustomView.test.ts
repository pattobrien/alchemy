import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import { adopt, OwnedBySomeoneElse } from "@/AdoptPolicy";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import {
  allNoop,
  createView,
  customView,
  deleteView,
  guard,
  hasLinearCreds,
  notFound,
  scratchTeamId,
} from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

const priority = (eq: number) => ({ priority: { eq } });

test.provider.skipIf(!hasLinearCreds)(
  "creates, updates, moves and deletes custom views",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const views = (v2: boolean) =>
        Effect.gen(function* () {
          const urgent = yield* Linear.CustomView("Urgent", {
            name: v2 ? "alc-cv-urgent-renamed" : "alc-cv-urgent",
            teamId: v2 ? undefined : teamId,
            shared: !v2,
            filterData: priority(v2 ? 2 : 1),
          });
          const workspace = yield* Linear.CustomView("Workspace", { name: "alc-cv-workspace" });
          return { urgentId: urgent.viewId, workspaceId: workspace.viewId };
        });

      const v1 = yield* stack.deploy(views(false));
      expect(yield* customView(v1.urgentId)).toEqual({
        name: "alc-cv-urgent",
        teamId,
        shared: true,
        filterData: priority(1),
      });
      expect(yield* customView(v1.workspaceId)).toMatchObject({
        name: "alc-cv-workspace",
        teamId: null,
        shared: false,
      });
      expect(allNoop(yield* stack.plan(views(false)))).toBe(true);

      const v2 = yield* stack.deploy(views(true));
      expect(v2).toEqual(v1);
      expect(yield* customView(v2.urgentId)).toEqual({
        name: "alc-cv-urgent-renamed",
        teamId: null,
        shared: false,
        filterData: priority(2),
      });
      expect(allNoop(yield* stack.plan(views(true)))).toBe(true);

      yield* stack.destroy();
      expect(yield* Effect.flip(customView(v2.urgentId))).toMatchObject(notFound("CustomView"));
      expect(yield* Effect.flip(customView(v2.workspaceId))).toMatchObject(notFound("CustomView"));
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "adopts an existing view and keeps its undeclared filter",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;
      const existing = yield* createView({
        name: "alc-cv-adopt",
        teamId,
        filterData: priority(3),
      });

      const view = Linear.CustomView("Adopt", { name: "alc-cv-adopt", teamId, shared: true });

      const refused = yield* stack.deploy(view).pipe(Effect.flip);
      expect(refused).toBeInstanceOf(OwnedBySomeoneElse);

      const adopted = yield* stack.deploy(view.pipe(adopt(true)));
      expect(adopted.viewId).toBe(existing);
      expect(yield* customView(existing)).toEqual({
        name: "alc-cv-adopt",
        teamId,
        shared: true,
        filterData: priority(3),
      });

      yield* stack.destroy();
      expect(yield* Effect.flip(customView(existing))).toMatchObject(notFound("CustomView"));
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "destroys a view already deleted outside the stack",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();

      const { viewId } = yield* stack.deploy(Linear.CustomView("Gone", { name: "alc-cv-gone" }));
      yield* deleteView(viewId);

      yield* stack.destroy();
      expect(yield* Effect.flip(customView(viewId))).toMatchObject(notFound("CustomView"));
    }),
  { timeout: 120_000 },
);
