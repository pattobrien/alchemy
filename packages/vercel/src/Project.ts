import * as projects from "@distilled.cloud/vercel/projects";
import { OwnedBySomeoneElse, Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";

export type ProjectFramework = projects.CreateProjectRequestFramework;

export type GitProvider = projects.CreateProjectRequestGitRepositoryType;

export interface GitRepository {
  /** Git provider hosting the repository. */
  type: GitProvider;
  /** Repository path, e.g. `vercel/next.js`. */
  repo: string;
}

export interface ProjectProps {
  /**
   * Project name, unique within the team. Lowercase letters, digits, `.`,
   * `_` and `-`, up to 100 characters. Defaults to a name generated from the
   * app, stage and logical ID. Renaming updates the project in place.
   */
  name?: string;
  /**
   * ID of the team that owns the project, e.g. `team.teamId`. Defaults to the
   * access token's default scope. Changing it triggers a replacement.
   */
  teamId?: string;
  /**
   * Framework preset used to build the project. `undefined` selects no
   * preset ("Other").
   */
  framework?: ProjectFramework;
  /**
   * Directory inside the repository that holds the project's source code.
   * `undefined` means the repository root.
   */
  rootDirectory?: string;
  /**
   * Git repository connected to the project. Pushes to it deploy the project.
   * The Vercel integration for the provider must have access to the
   * repository. Changing it triggers a replacement, because the API used by
   * this provider cannot connect or disconnect a repository on an existing
   * project. Omitting it leaves an existing connection in place.
   */
  gitRepository?: GitRepository;
}

export interface ProjectGitRepository {
  /** Git provider hosting the repository. */
  type: string;
  /** Repository path, e.g. `vercel/next.js`. */
  repo: string;
  /** Branch that produces production deployments. */
  productionBranch: string;
}

export interface ProjectAttributes {
  /** Vercel project ID, e.g. `prj_abc123`. */
  projectId: string;
  /** Project name. */
  name: string;
  /** Team ID the project was requested under, if any. */
  teamId: string | undefined;
  /** ID of the account (team) that owns the project. */
  accountId: string;
  /** Framework preset, or `null` when none is selected. */
  framework: ProjectFramework | null;
  /** Source directory inside the repository, or `null` for the root. */
  rootDirectory: string | null;
  /** Connected Git repository, if any. */
  gitRepository: ProjectGitRepository | undefined;
}

export interface Project extends Resource<
  "Vercel.Project",
  ProjectProps,
  ProjectAttributes,
  never,
  Providers
> {}

/**
 * A Vercel project: the unit that builds and serves an app from a Git
 * repository.
 *
 * Vercel projects carry no tags, so a project that exists before the first
 * deploy (same name, no state) is reported as unowned and requires
 * `Alchemy.adopt(true)`.
 *
 * ### Creating a project
 * **Example:** Project with a framework preset
 * ```typescript
 * const project = yield* Vercel.Project("Web", {
 *   framework: "nextjs",
 * });
 * ```
 *
 * ### Connecting a Git repository
 * **Example:** Monorepo app linked to GitHub
 * ```typescript
 * const team = yield* Vercel.Team("Team", { slug: "my-team" }).pipe(Alchemy.adopt(true));
 * const project = yield* Vercel.Project("Web", {
 *   teamId: team.teamId,
 *   framework: "nextjs",
 *   rootDirectory: "apps/web",
 *   gitRepository: { type: "github", repo: "my-org/my-repo" },
 * });
 * ```
 *
 * ### Adopting an existing project
 * **Example:** Adopt a project by name
 * ```typescript
 * const project = yield* Vercel.Project("Web", {
 *   name: "my-existing-project",
 *   framework: "nextjs",
 * }).pipe(Alchemy.adopt(true));
 * ```
 *
 * @resource
 * @product Project
 */
export const Project = Resource<Project>("Vercel.Project");

export class ProjectGitRepositoryMismatch extends Data.TaggedError("ProjectGitRepositoryMismatch")<{
  message: string;
}> {}

const toGitRepository = (
  link: projects.GetProjectResponseLink | undefined,
): ProjectGitRepository | undefined => {
  if (!link) return undefined;
  const { productionBranch } = link;
  switch (link.type) {
    case "github":
    case "github-limited":
    case "github-custom-host":
      return link.repo
        ? { type: link.type, repo: `${link.org}/${link.repo}`, productionBranch }
        : undefined;
    case "vercel":
    case "v0":
      return { type: link.type, repo: `${link.org}/${link.repo}`, productionBranch };
    case "gitlab":
      return {
        type: link.type,
        repo: `${link.projectNamespace}/${link.projectName}`,
        productionBranch,
      };
    case "bitbucket":
      return { type: link.type, repo: `${link.owner}/${link.slug}`, productionBranch };
    case "cursor-origin":
      return { type: link.type, repo: `${link.owner}/${link.repo}`, productionBranch };
  }
};

const sameRepository = (
  a: Pick<ProjectGitRepository, "type" | "repo"> | undefined,
  b: Pick<ProjectGitRepository, "type" | "repo"> | undefined,
) => a?.type === b?.type && a?.repo.toLowerCase() === b?.repo.toLowerCase();

const getProject = Effect.fn(function* (idOrName: string, teamId: string | undefined) {
  const project = yield* projects.getProject({ idOrName, teamId });
  return {
    projectId: project.id,
    name: project.name,
    teamId,
    accountId: project.accountId,
    framework: project.framework ?? null,
    rootDirectory: project.rootDirectory ?? null,
    gitRepository: toGitRepository(project.link),
  } satisfies ProjectAttributes;
});

const observeProject = (idOrName: string, teamId: string | undefined) =>
  getProject(idOrName, teamId).pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined)));

const projectName = (id: string, name: string | undefined) =>
  name ? Effect.succeed(name) : createPhysicalName({ id, lowercase: true, maxLength: 100 });

export const ProjectProvider = () =>
  Provider.succeed(Project, {
    stables: ["projectId", "accountId"],
    diff: Effect.fn(function* ({ olds, news }) {
      if (!isResolved(news)) return;
      if (news.teamId !== olds.teamId || !sameRepository(news.gitRepository, olds.gitRepository)) {
        return {
          action: "replace",
          deleteFirst: news.name !== undefined && news.name === olds.name,
        } as const;
      }
    }),
    read: Effect.fn(function* ({ id, olds, output }) {
      if (output) return yield* observeProject(output.projectId, output.teamId);
      const name = yield* projectName(id, olds.name);
      const attrs = yield* observeProject(name, olds.teamId);
      return attrs && Unowned(attrs);
    }),
    reconcile: Effect.fn(function* ({ id, news, output }) {
      const name = yield* projectName(id, news.name ?? output?.name);
      let observed = output ? yield* observeProject(output.projectId, news.teamId) : undefined;
      if (!observed) {
        const byName = yield* observeProject(name, news.teamId);
        if (byName && byName.projectId !== output?.projectId) {
          return yield* new OwnedBySomeoneElse({
            message: `Vercel project "${name}" requires explicit adoption`,
            resourceType: "Vercel.Project",
            logicalId: id,
            physicalName: byName.projectId,
          });
        }
      }
      if (!observed) {
        const created = yield* projects.createProject({
          teamId: news.teamId,
          name,
          framework: news.framework,
          rootDirectory: news.rootDirectory,
          gitRepository: news.gitRepository,
        });
        observed = yield* getProject(created.id, news.teamId);
      }
      if (news.gitRepository && !sameRepository(news.gitRepository, observed.gitRepository)) {
        return yield* new ProjectGitRepositoryMismatch({
          message: `Vercel project "${observed.name}" is connected to ${observed.gitRepository?.repo ?? "no repository"}, not ${news.gitRepository.repo}; connect it in the Vercel dashboard or replace the project`,
        });
      }
      const framework = news.framework ?? null;
      const rootDirectory = news.rootDirectory ?? null;
      if (
        observed.name !== name ||
        observed.framework !== framework ||
        observed.rootDirectory !== rootDirectory
      ) {
        yield* projects.updateProject({
          idOrName: observed.projectId,
          teamId: news.teamId,
          name: observed.name !== name ? name : undefined,
          framework: observed.framework !== framework ? framework : undefined,
          rootDirectory: observed.rootDirectory !== rootDirectory ? rootDirectory : undefined,
        });
        observed = yield* getProject(observed.projectId, news.teamId);
      }
      return observed;
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* projects
        .deleteProject({ idOrName: output.projectId, teamId: output.teamId })
        .pipe(Effect.catchTag("NotFound", () => Effect.void));
    }),
  });
