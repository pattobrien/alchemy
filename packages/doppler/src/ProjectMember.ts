import {
  listEnvironments,
  projectMembersAdd,
  projectMembersDelete,
  projectMembersList,
  projectMembersUpdate,
} from "@distilled.cloud/doppler";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import { findInPages, ignoreNotFound, orUndefined, sameSet } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export type ProjectRole = "admin" | "collaborator" | "viewer";

export interface ProjectMemberProps {
  /**
   * Slug of the project to grant access to.
   */
  project: string;

  /**
   * Kind of workplace member.
   */
  memberType: "service_account" | "workplace_user";

  /**
   * Slug of the service account or workplace user.
   */
  memberSlug: string;

  /**
   * Project role.
   */
  role: ProjectRole;

  /**
   * Environment slugs the member can access. Unset grants every environment
   * the project has when the member is deployed.
   */
  environments?: string[];
}

export interface ProjectMemberAttributes {
  /**
   * Slug of the project.
   */
  project: string;

  /**
   * Kind of workplace member.
   */
  memberType: "service_account" | "workplace_user";

  /**
   * Slug of the service account or workplace user.
   */
  memberSlug: string;
}

export interface ProjectMember extends Resource<
  "Doppler.ProjectMember",
  ProjectMemberProps,
  ProjectMemberAttributes,
  never,
  Providers
> {}

/**
 * A workplace member's access to a Doppler project: a role, scoped to some
 * or all of the project's environments.
 *
 * A membership that already exists is never taken over silently: deploy it
 * with `adopt(true)` to manage it.
 *
 * ### Granting Access
 * **Example:** Read-Only Access to Two Environments
 * ```typescript
 * yield* Doppler.ProjectMember("ci-api", {
 *   project: "api",
 *   memberType: "service_account",
 *   memberSlug: ci.slug,
 *   role: "viewer",
 *   environments: ["stg", "prd"],
 * });
 * ```
 *
 * @resource
 * @product Doppler
 */
export const ProjectMember = Resource<ProjectMember>("Doppler.ProjectMember");

const find = (props: ProjectMemberAttributes) =>
  orUndefined(
    findInPages(
      (page) =>
        projectMembersList({ project: props.project, ...page }).pipe(
          Effect.map((response) => response.members),
        ),
      (member) => member.type === props.memberType && member.slug === props.memberSlug,
    ),
  );

const allEnvironments = (project: string) =>
  listEnvironments({ project }).pipe(
    Effect.map(({ environments = [] }) => environments.map((environment) => environment.id!)),
  );

const attributes = ({
  project,
  memberType,
  memberSlug,
}: ProjectMemberAttributes): ProjectMemberAttributes => ({ project, memberType, memberSlug });

export const ProjectMemberProvider = () =>
  Provider.succeed(ProjectMember, {
    stables: ["project", "memberType", "memberSlug"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) &&
          (news.project !== olds.project ||
            news.memberType !== olds.memberType ||
            news.memberSlug !== olds.memberSlug)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds }) =>
      find(olds).pipe(Effect.map((member) => member && Unowned(attributes(olds)))),

    reconcile: Effect.fn(function* ({ news }) {
      const environments = news.environments ?? (yield* allEnvironments(news.project));
      const live = yield* find(news);
      const request = {
        project: news.project,
        type: news.memberType,
        slug: news.memberSlug,
        role: news.role,
        environments,
      };
      if (live === undefined) {
        yield* projectMembersAdd(request);
      } else {
        const granted = live.access_all_environments
          ? yield* allEnvironments(news.project)
          : (live.environments ?? []);
        if (live.role?.identifier !== news.role || !sameSet(granted, environments)) {
          yield* projectMembersUpdate(request);
        }
      }
      return attributes(news);
    }),

    delete: ({ output }) =>
      find(output).pipe(
        Effect.flatMap((member) =>
          member === undefined
            ? Effect.void
            : ignoreNotFound(
                projectMembersDelete({
                  project: output.project,
                  type: output.memberType,
                  slug: output.memberSlug,
                }),
              ),
        ),
      ),
  });
