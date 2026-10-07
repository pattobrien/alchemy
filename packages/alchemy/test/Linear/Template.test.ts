import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import {
  allNoop,
  deleteTemplate,
  guard,
  hasLinearCreds,
  scratchTeamId,
  template,
} from "./workspace.ts";

const { test } = Test.make({ providers: Linear.providers() });

const missing = (id: string) => ({
  _tag: "LinearInvalidInput",
  message: `No template found with id ${id}`,
});

test.provider.skipIf(!hasLinearCreds)(
  "creates, updates, replaces and deletes templates",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const templates = (version: 1 | 2 | 3) =>
        Effect.gen(function* () {
          const team = yield* Linear.Template("TeamTemplate", {
            type: version === 3 ? "project" : "issue",
            name: version === 1 ? "alc-tpl-team" : "alc-tpl-team-renamed",
            teamId,
            templateJson: JSON.stringify(
              version === 1 ? { title: "alc v1" } : { title: "alc v2", priority: 2 },
            ),
          });
          const workspace = yield* Linear.Template("WorkspaceTemplate", {
            type: "issue",
            name: "alc-tpl-workspace",
            templateJson: JSON.stringify({ title: "alc workspace" }),
          });
          return { teamTemplateId: team.templateId, workspaceTemplateId: workspace.templateId };
        });

      const v1 = yield* stack.deploy(templates(1));
      expect(yield* template(v1.teamTemplateId)).toEqual({
        type: "issue",
        name: "alc-tpl-team",
        teamId,
        templateData: { title: "alc v1" },
      });
      expect(yield* template(v1.workspaceTemplateId)).toEqual({
        type: "issue",
        name: "alc-tpl-workspace",
        teamId: null,
        templateData: { title: "alc workspace" },
      });
      expect(allNoop(yield* stack.plan(templates(1)))).toBe(true);

      const v2 = yield* stack.deploy(templates(2));
      expect(v2).toEqual(v1);
      expect(yield* template(v2.teamTemplateId)).toEqual({
        type: "issue",
        name: "alc-tpl-team-renamed",
        teamId,
        templateData: { title: "alc v2", priority: 2 },
      });

      const v3 = yield* stack.deploy(templates(3));
      expect(v3.teamTemplateId).not.toBe(v2.teamTemplateId);
      expect(v3.workspaceTemplateId).toBe(v1.workspaceTemplateId);
      expect((yield* template(v3.teamTemplateId)).type).toBe("project");
      const replaced = yield* Effect.flip(template(v2.teamTemplateId));
      expect(replaced).toMatchObject(missing(v2.teamTemplateId));

      yield* stack.destroy();
      const gone = yield* Effect.flip(template(v3.teamTemplateId));
      expect(gone).toMatchObject(missing(v3.teamTemplateId));
      const goneWorkspace = yield* Effect.flip(template(v3.workspaceTemplateId));
      expect(goneWorkspace).toMatchObject(missing(v3.workspaceTemplateId));
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasLinearCreds)(
  "destroys a template already deleted outside the stack",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();
      const teamId = yield* scratchTeamId;

      const { templateId } = yield* stack.deploy(
        Linear.Template("Gone", {
          type: "issue",
          name: "alc-tpl-gone",
          teamId,
          templateJson: JSON.stringify({ title: "gone" }),
        }),
      );
      yield* deleteTemplate(templateId);

      yield* stack.destroy();
      const gone = yield* Effect.flip(template(templateId));
      expect(gone).toMatchObject(missing(templateId));
    }),
  { timeout: 120_000 },
);
