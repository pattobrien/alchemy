import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import {
  allNoop,
  guard,
  hasLinearCreds,
  issueLabel,
  notFound,
  scratchTeamId,
} from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

test.provider.skipIf(!hasLinearCreds)(
  "creates, updates and deletes a team label group",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const labels = (v2: boolean) =>
        Effect.gen(function* () {
          const customer = yield* Linear.TeamLabel("Customer", {
            name: "alc-tl-customer",
            teamId,
            isGroup: true,
            color: "#5e6ad2",
          });
          const acme = yield* Linear.TeamLabel("Acme", {
            name: v2 ? "alc-tl-acme-renamed" : "alc-tl-acme",
            teamId,
            parentId: customer.labelId,
            color: v2 ? "#f2c94c" : "#26b5ce",
            description: v2 ? "renamed" : "first",
          });
          return { customerId: customer.labelId, acmeId: acme.labelId };
        });

      const v1 = yield* stack.deploy(labels(false));
      expect(yield* issueLabel(v1.customerId)).toEqual({
        name: "alc-tl-customer",
        color: "#5e6ad2",
        description: null,
        isGroup: true,
        parentId: null,
        teamId,
      });
      expect(yield* issueLabel(v1.acmeId)).toEqual({
        name: "alc-tl-acme",
        color: "#26b5ce",
        description: "first",
        isGroup: false,
        parentId: v1.customerId,
        teamId,
      });
      expect(allNoop(yield* stack.plan(labels(false)))).toBe(true);

      const v2 = yield* stack.deploy(labels(true));
      expect(v2).toEqual(v1);
      expect(yield* issueLabel(v2.acmeId)).toEqual({
        name: "alc-tl-acme-renamed",
        color: "#f2c94c",
        description: "renamed",
        isGroup: false,
        parentId: v1.customerId,
        teamId,
      });

      yield* stack.destroy();
      expect(yield* Effect.flip(issueLabel(v2.acmeId))).toMatchObject(notFound("IssueLabel"));
      expect(yield* Effect.flip(issueLabel(v2.customerId))).toMatchObject(notFound("IssueLabel"));
    }),
  { timeout: 120_000 },
);
