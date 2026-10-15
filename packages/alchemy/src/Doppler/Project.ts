import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from "@distilled.cloud/doppler";
import * as Effect from "effect/Effect";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { findInPages, ignoreNotFound } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface ProjectProps {
  /**
   * Project name, unique in the workplace. Changing it replaces the project.
   */
  name: string;

  /**
   * Project description. Unset leaves the current description alone.
   */
  description?: string;
}

export interface ProjectAttributes {
  /**
   * Project name.
   */
  name: string;

  /**
   * Project slug, the identifier other Doppler resources take as `project`.
   */
  slug: string;

  /**
   * Doppler ID of the project.
   */
  id: string;
}

export interface Project extends Resource<
  "Doppler.Project",
  ProjectProps,
  ProjectAttributes,
  never,
  Providers
> {}

/**
 * A Doppler project.
 *
 * Deleting a project deletes every environment, config and secret in it. A
 * project that already exists with the same name is never taken over
 * silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a Project
 * **Example:** Basic Project
 * ```typescript
 * const project = yield* Doppler.Project("api", { name: "api" });
 * ```
 *
 * ### Adopting an Existing Project
 * **Example:** Manage a Project Created in the Dashboard
 * ```typescript
 * import { adopt } from "alchemy/AdoptPolicy";
 *
 * const project = yield* Doppler.Project("api", { name: "api" }).pipe(adopt(true));
 * ```
 *
 * @resource
 * @product Doppler
 */
export const Project = Resource<Project>("Doppler.Project");

const find = (name: string) =>
  findInPages(
    (page) => listProjects(page).pipe(Effect.map((response) => response.projects)),
    (project) => project.name === name,
  );

const attributes = (project: { id?: string; slug?: string; name?: string }) => ({
  name: project.name!,
  slug: project.slug ?? project.id!,
  id: project.id!,
});

export const ProjectProvider = () =>
  Provider.succeed(Project, {
    stables: ["id", "slug", "name"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && news.name !== olds.name ? { action: "replace" as const } : undefined,
      ),

    read: ({ olds, output }) =>
      find(output?.name ?? olds.name).pipe(
        Effect.map((project) => project && Unowned(attributes(project))),
      ),

    reconcile: Effect.fn(function* ({ news }) {
      const project =
        (yield* find(news.name)) ??
        (yield* createProject({ name: news.name, description: news.description }).pipe(
          Effect.flatMap(({ project }) => Effect.fromNullishOr(project)),
        ));
      if (news.description !== undefined && news.description !== (project.description ?? "")) {
        yield* updateProject({
          project: project.id!,
          name: news.name,
          description: news.description,
        });
      }
      return attributes(project);
    }),

    delete: ({ output }) => ignoreNotFound(deleteProject({ project: output.slug })),
  });
