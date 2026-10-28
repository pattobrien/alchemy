import { expect } from "@alchemy.run/test";
import { Project } from "@alchemy.run/vercel/Project";
import {
  ProjectDomain,
  RedirectStatusCodeWithoutRedirect,
} from "@alchemy.run/vercel/ProjectDomain";
import { providers } from "@alchemy.run/vercel/Providers";
import * as projects from "@distilled.cloud/vercel/projects";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Result from "effect/Result";

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

const MOVED = "alchemy-test-vercel-domain-moved.vercel.app";

const moveProgram = (target: "First" | "Second") =>
  Effect.gen(function* () {
    const first = yield* Project("First", { name: "alchemy-test-vercel-move-first" });
    const second = yield* Project("Second", { name: "alchemy-test-vercel-move-second" });
    const domain = yield* ProjectDomain("Moved", {
      project: target === "First" ? first.projectId : second.projectId,
      name: MOVED,
    });
    return { first, second, domain };
  });

test.provider(
  "moves a domain to another project in the same stack",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const initial = yield* stack.deploy(moveProgram("First"));
      expect(initial.domain.projectId).toBe(initial.first.projectId);

      const moved = yield* stack.deploy(moveProgram("Second"));
      expect(moved.domain.projectId).toBe(moved.second.projectId);

      const onSecond = yield* projects.getProjectDomain({
        idOrName: moved.second.projectId,
        domain: MOVED,
      });
      expect(onSecond.projectId).toBe(moved.second.projectId);

      const onFirst = yield* projects
        .getProjectDomain({ idOrName: moved.first.projectId, domain: MOVED })
        .pipe(
          Effect.as(true),
          Effect.catchTag("NotFound", () => Effect.succeed(false)),
        );
      expect(onFirst).toBe(false);

      yield* stack.destroy();
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:domain", "live"], timeout: 120_000 },
);

test.provider(
  "rejects redirectStatusCode without redirect",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const rejected = yield* stack
        .deploy(
          Effect.gen(function* () {
            const project = yield* Project("InvalidProject", {
              name: "alchemy-test-vercel-domain-invalid",
            });
            return yield* ProjectDomain("Invalid", {
              project: project.projectId,
              name: "alchemy-test-vercel-domain-invalid-alias.vercel.app",
              redirectStatusCode: 308,
            });
          }),
        )
        .pipe(Effect.result);
      expect(Result.isFailure(rejected)).toBe(true);
      if (Result.isFailure(rejected))
        expect(rejected.failure).toBeInstanceOf(RedirectStatusCodeWithoutRedirect);

      yield* stack.destroy();
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:domain", "live"], timeout: 120_000 },
);
