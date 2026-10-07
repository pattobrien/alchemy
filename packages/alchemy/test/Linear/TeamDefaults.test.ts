import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import {
  allNoop,
  guard,
  hasLinearCreds,
  scratchTeamId,
  team,
  workflowState,
  workflowStates,
} from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

test.provider.skipIf(!hasLinearCreds)(
  "points a team's default state at a state created in the same deploy",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;
      const [backlogId] = yield* workflowStates({
        team: { id: { eq: teamId } },
        name: { eq: "Backlog" },
      });

      const defaults = (useInbox: boolean) =>
        Effect.gen(function* () {
          const inbox = yield* Linear.WorkflowState("Inbox", {
            name: "alc-defaults-inbox",
            type: "backlog",
            color: "#bec2c8",
            teamId,
          });
          const settings = yield* Linear.TeamDefaults("Defaults", {
            teamId,
            defaultIssueStateId: useInbox ? inbox.stateId : backlogId,
          });
          return {
            inboxId: inbox.stateId,
            defaultIssueStateId: settings.defaultIssueStateId,
          };
        });

      const pointed = yield* stack.deploy(defaults(true));
      expect(pointed.defaultIssueStateId).toBe(pointed.inboxId);
      expect((yield* team(teamId)).defaultIssueStateId).toBe(pointed.inboxId);
      expect(allNoop(yield* stack.plan(defaults(true)))).toBe(true);

      const restored = yield* stack.deploy(defaults(false));
      expect(restored.defaultIssueStateId).toBe(backlogId);
      expect((yield* team(teamId)).defaultIssueStateId).toBe(backlogId);

      yield* stack.destroy();
      expect((yield* workflowState(pointed.inboxId)).archived).toBe(true);
      expect((yield* team(teamId)).defaultIssueStateId).toBe(backlogId);
    }),
  { timeout: 120_000 },
);
