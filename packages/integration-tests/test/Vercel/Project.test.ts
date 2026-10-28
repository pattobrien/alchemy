import { expect } from "@alchemy.run/test";
import { Project } from "@alchemy.run/vercel/Project";
import { providers } from "@alchemy.run/vercel/Providers";
import * as projects from "@distilled.cloud/vercel/projects";
import { adopt, OwnedBySomeoneElse } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Result from "effect/Result";

const { test } = Test.make({ providers: providers() });

const logLevel = Effect.provideService(MinimumLogLevel, process.env.DEBUG ? "Debug" : "Info");

const projectGone = (idOrName: string) =>
  projects.getProject({ idOrName }).pipe(
    Effect.as(false),
    Effect.catchTag("NotFound", () => Effect.succeed(true)),
  );

test.provider(
  "create, update in place, rename and delete a project",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const created = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Project("Web", {
            name: "alchemy-test-vercel-project",
            framework: "vite",
            rootDirectory: "apps/web",
          });
        }),
      );
      expect(created.name).toBe("alchemy-test-vercel-project");
      expect(created.framework).toBe("vite");
      expect(created.rootDirectory).toBe("apps/web");
      expect(created.gitRepository).toBeUndefined();

      const live = yield* projects.getProject({ idOrName: created.projectId });
      expect(live.framework).toBe("vite");
      expect(live.rootDirectory).toBe("apps/web");

      const updated = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Project("Web", {
            name: "alchemy-test-vercel-project-renamed",
            framework: "nextjs",
          });
        }),
      );
      expect(updated.projectId).toBe(created.projectId);
      expect(updated.name).toBe("alchemy-test-vercel-project-renamed");
      expect(updated.framework).toBe("nextjs");
      expect(updated.rootDirectory).toBeNull();

      const renamed = yield* projects.getProject({ idOrName: created.projectId });
      expect(renamed.name).toBe("alchemy-test-vercel-project-renamed");
      expect(renamed.framework).toBe("nextjs");
      expect(renamed.rootDirectory ?? null).toBeNull();

      yield* stack.destroy();

      expect(yield* projectGone(created.projectId)).toBe(true);
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:project", "live"], timeout: 120_000 },
);

test.provider(
  "refuses a same-named project until adopted",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const name = "alchemy-test-vercel-foreign";
      const foreign = yield* projects
        .createProject({ name, framework: "vite" })
        .pipe(
          Effect.catchTag("Conflict", () =>
            projects.getProject({ idOrName: name }).pipe(Effect.map(({ id }) => ({ id }))),
          ),
        );

      const program = (adoptIt: boolean) =>
        Effect.gen(function* () {
          return yield* Project("Foreign", { name, framework: "nextjs" }).pipe(adopt(adoptIt));
        });

      const refused = yield* stack.deploy(program(false)).pipe(Effect.result);
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) expect(refused.failure).toBeInstanceOf(OwnedBySomeoneElse);
      expect((yield* projects.getProject({ idOrName: foreign.id })).framework).toBe("vite");

      const adopted = yield* stack.deploy(program(true));
      expect(adopted.projectId).toBe(foreign.id);
      expect(adopted.framework).toBe("nextjs");

      yield* stack.destroy();

      expect(yield* projectGone(foreign.id)).toBe(true);
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:project", "live"], timeout: 120_000 },
);

const gitRepo = process.env.VERCEL_TEST_GIT_REPO;

test.provider.skipIf(!gitRepo)(
  "creates a project linked to a GitHub repository",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const project = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Project("Linked", {
            name: "alchemy-test-vercel-linked",
            framework: "vite",
            gitRepository: { type: "github", repo: gitRepo! },
          });
        }),
      );
      expect(project.gitRepository?.type).toBe("github");
      expect(project.gitRepository?.repo.toLowerCase()).toBe(gitRepo!.toLowerCase());
      expect(project.gitRepository?.productionBranch).toBeDefined();

      const live = yield* projects.getProject({ idOrName: project.projectId });
      expect(live.link?.type).toBe("github");

      const redeployed = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Project("Linked", {
            name: "alchemy-test-vercel-linked",
            framework: "vite",
            rootDirectory: "web",
            gitRepository: { type: "github", repo: gitRepo! },
          });
        }),
      );
      expect(redeployed.projectId).toBe(project.projectId);
      expect(redeployed.rootDirectory).toBe("web");

      yield* stack.destroy();

      expect(yield* projectGone(project.projectId)).toBe(true);
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:project", "live"], timeout: 120_000 },
);
