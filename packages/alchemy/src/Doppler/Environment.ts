import {
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  renameEnvironment,
} from "@distilled.cloud/doppler";
import * as Effect from "effect/Effect";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { ignoreNotFound, orUndefined } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface EnvironmentProps {
  /**
   * Slug of the project the environment belongs to. Changing it replaces the
   * environment.
   */
  project: string;

  /**
   * Environment slug, such as `prd`. Changing it renames the environment in
   * place and keeps its configs and secrets.
   */
  slug: string;

  /**
   * Display name, such as `Production`.
   */
  name: string;
}

export interface EnvironmentAttributes {
  /**
   * Slug of the project the environment belongs to.
   */
  project: string;

  /**
   * Environment slug.
   */
  slug: string;

  /**
   * Display name.
   */
  name: string;
}

export interface Environment extends Resource<
  "Doppler.Environment",
  EnvironmentProps,
  EnvironmentAttributes,
  never,
  Providers
> {}

/**
 * An environment in a Doppler project. Creating one also creates its root
 * config, named after the slug.
 *
 * An environment that already exists with the same slug is never taken over
 * silently: deploy it with `adopt(true)` to manage it. Once managed, changing
 * `slug` renames it in place.
 *
 * ### Creating an Environment
 * **Example:** Pull Request Environment
 * ```typescript
 * const project = yield* Doppler.Project("api", { name: "api" });
 * const pr = yield* Doppler.Environment("pr", {
 *   project: project.slug,
 *   slug: "pr",
 *   name: "Pull Request",
 * });
 * ```
 *
 * ### Renaming an Environment
 * **Example:** Adopt `prod`, Then Change the Slug to `prd`
 * ```typescript
 * import { adopt } from "alchemy/AdoptPolicy";
 *
 * // first deploy: slug "prod" adopts the existing environment
 * // next deploy: slug "prd" renames it and keeps its secrets
 * const production = yield* Doppler.Environment("production", {
 *   project: "api",
 *   slug: "prd",
 *   name: "Production",
 * }).pipe(adopt(true));
 * ```
 *
 * @resource
 * @product Doppler
 */
export const Environment = Resource<Environment>("Doppler.Environment");

const get = (project: string, slug: string) =>
  orUndefined(getEnvironment({ project, environment: slug })).pipe(
    Effect.map((response) => response?.environment),
  );

export const EnvironmentProvider = () =>
  Provider.succeed(Environment, {
    stables: ["project"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && news.project !== olds.project
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds, output }) =>
      get(olds.project, output?.slug ?? olds.slug).pipe(
        Effect.map(
          (environment) =>
            environment &&
            Unowned({ project: olds.project, slug: environment.id!, name: environment.name! }),
        ),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      const live =
        (yield* get(news.project, news.slug)) ??
        (output && output.project === news.project && output.slug !== news.slug
          ? yield* get(news.project, output.slug)
          : undefined);
      if (live === undefined) {
        yield* createEnvironment({ project: news.project, slug: news.slug, name: news.name });
      } else if (live.id !== news.slug || live.name !== news.name) {
        yield* renameEnvironment({
          project: news.project,
          environment: live.id!,
          slug: live.id === news.slug ? undefined : news.slug,
          name: live.name === news.name ? undefined : news.name,
        });
      }
      return { project: news.project, slug: news.slug, name: news.name };
    }),

    delete: ({ output }) =>
      ignoreNotFound(deleteEnvironment({ project: output.project, environment: output.slug })),
  });
