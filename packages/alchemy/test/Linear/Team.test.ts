import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import { adopt, OwnedBySomeoneElse } from "@/AdoptPolicy";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import { allNoop, guard, hasLinearCreds, scratchKey, scratchTeamId, team } from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

const scratch = (name: string, triageEnabled: boolean) =>
  Linear.Team("Scratch", { name, key: scratchKey, triageEnabled }).pipe(adopt(true));

test.provider.skipIf(!hasLinearCreds)(
  "refuses an existing team without adopt",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();

      const error = yield* stack
        .deploy(Linear.Team("Existing", { name: "FineDesigns", key: "FIN" }))
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(OwnedBySomeoneElse);

      yield* stack.destroy();
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "adopts, updates and retains a team",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const adopted = yield* stack.deploy(scratch("Alchemy Scratch", true));
      expect(adopted.teamId).toBe(teamId);
      expect(yield* team(teamId)).toMatchObject({
        name: "Alchemy Scratch",
        key: scratchKey,
        triageEnabled: true,
      });
      expect(allNoop(yield* stack.plan(scratch("Alchemy Scratch", true)))).toBe(true);

      const updated = yield* stack.deploy(scratch("Alchemy Scratch v2", false));
      expect(updated.teamId).toBe(teamId);
      expect(yield* team(teamId)).toMatchObject({
        name: "Alchemy Scratch v2",
        key: scratchKey,
        triageEnabled: false,
      });

      yield* stack.deploy(scratch("Alchemy Scratch", true));
      yield* stack.destroy();
      expect(yield* team(teamId)).toMatchObject({
        name: "Alchemy Scratch",
        key: scratchKey,
        triageEnabled: true,
      });
    }),
  { timeout: 120_000 },
);
