import { expect } from "@alchemy.run/test";
import { Project } from "@alchemy.run/vercel/Project";
import { ProjectDomain } from "@alchemy.run/vercel/ProjectDomain";
import { providers } from "@alchemy.run/vercel/Providers";
import * as projects from "@distilled.cloud/vercel/projects";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";

const { test } = Test.make({ providers: providers() });

const logLevel = Effect.provideService(MinimumLogLevel, process.env.DEBUG ? "Debug" : "Info");

const PRIMARY = "alchemy-test-vercel-domain-primary.vercel.app";
const ALIAS = "alchemy-test-vercel-domain-alias.vercel.app";

const program = (redirect: boolean) =>
  Effect.gen(function* () {
    const project = yield* Project("Site", { name: "alchemy-test-vercel-domain" });
    const primary = yield* ProjectDomain("Primary", { project: project.projectId, name: PRIMARY });
    const alias = yield* ProjectDomain("Alias", {
      project: project.projectId,
      name: ALIAS,
      ...(redirect ? { redirect: primary.name, redirectStatusCode: 308 as const } : {}),
    });
    return { project, primary, alias };
  });

test.provider(
  "assigns domains to a project and syncs the redirect",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const initial = yield* stack.deploy(program(false));
      expect(initial.primary.name).toBe(PRIMARY);
      expect(initial.primary.apexName).toBe("vercel.app");
      expect(initial.primary.projectId).toBe(initial.project.projectId);
      expect(initial.primary.verified).toBe(true);
      expect(initial.alias.redirect).toBeNull();

      const live = yield* projects.getProjectDomain({
        idOrName: initial.project.projectId,
        domain: PRIMARY,
      });
      expect(live.verified).toBe(true);

      const redirected = yield* stack.deploy(program(true));
      expect(redirected.alias.redirect).toBe(PRIMARY);
      expect(redirected.alias.redirectStatusCode).toBe(308);
      const liveAlias = yield* projects.getProjectDomain({
        idOrName: initial.project.projectId,
        domain: ALIAS,
      });
      expect(liveAlias.redirect).toBe(PRIMARY);
      expect(liveAlias.redirectStatusCode).toBe(308);

      const cleared = yield* stack.deploy(program(false));
      expect(cleared.alias.redirect).toBeNull();
      expect(cleared.alias.redirectStatusCode).toBeNull();

      yield* stack.destroy();

      const gone = yield* projects.getProject({ idOrName: initial.project.projectId }).pipe(
        Effect.as(false),
        Effect.catchTag("NotFound", () => Effect.succeed(true)),
      );
      expect(gone).toBe(true);
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:domain", "live"], timeout: 120_000 },
);
