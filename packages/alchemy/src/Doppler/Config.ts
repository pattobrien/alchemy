import { createConfig, deleteConfig, getConfig } from "@distilled.cloud/doppler";
import * as Effect from "effect/Effect";
import { Unowned } from "../AdoptPolicy.ts";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { ignoreNotFound, orUndefined } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface ConfigProps {
  /**
   * Slug of the project the config belongs to.
   */
  project: string;

  /**
   * Slug of the environment the config belongs to.
   */
  environment: string;

  /**
   * Config name. The environment's root config is named after the
   * environment slug, the personal config is `<environment>_personal`, and a
   * branch config is `<environment>_<suffix>`, such as `dev_ci`.
   */
  name: string;
}

export interface ConfigAttributes {
  /**
   * Slug of the project the config belongs to.
   */
  project: string;

  /**
   * Slug of the environment the config belongs to.
   */
  environment: string;

  /**
   * Config name.
   */
  name: string;

  /**
   * Whether this is the environment's root config.
   */
  root: boolean;
}

export interface Config extends Resource<
  "Doppler.Config",
  ConfigProps,
  ConfigAttributes,
  never,
  Providers
> {}

/**
 * A config in a Doppler environment.
 *
 * Doppler creates the root config with its environment and the personal
 * config for each workplace user, so declaring either only adopts it:
 * deploying never creates one and destroying never deletes one. Branch
 * configs are created and deleted. A branch config that already exists is
 * never taken over silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Declaring Configs
 * **Example:** Branch Config
 * ```typescript
 * const ci = yield* Doppler.Config("dev-ci", {
 *   project: "api",
 *   environment: "dev",
 *   name: "dev_ci",
 * });
 * ```
 *
 * **Example:** Root Config
 * ```typescript
 * const prd = yield* Doppler.Config("prd", {
 *   project: "api",
 *   environment: "prd",
 *   name: "prd",
 * });
 * ```
 *
 * @resource
 * @product Doppler
 */
export const Config = Resource<Config>("Doppler.Config");

const isBuiltIn = ({ environment, name }: ConfigProps) =>
  name === environment || name === `${environment}_personal`;

const get = (project: string, config: string) =>
  orUndefined(getConfig({ project, config })).pipe(Effect.map((response) => response?.config));

const attributes = (props: ConfigProps, root: boolean | undefined): ConfigAttributes => ({
  project: props.project,
  environment: props.environment,
  name: props.name,
  root: root ?? false,
});

export const ConfigProvider = () =>
  Provider.succeed(Config, {
    stables: ["project", "environment", "name", "root"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) &&
          (news.project !== olds.project ||
            news.environment !== olds.environment ||
            news.name !== olds.name)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds }) =>
      get(olds.project, olds.name).pipe(
        Effect.map((config) => {
          if (config === undefined) return undefined;
          const attrs = attributes(olds, config.root);
          return isBuiltIn(olds) ? attrs : Unowned(attrs);
        }),
      ),

    reconcile: Effect.fn(function* ({ news }) {
      const config = isBuiltIn(news)
        ? (yield* getConfig({ project: news.project, config: news.name })).config
        : ((yield* get(news.project, news.name)) ??
          (yield* createConfig({
            project: news.project,
            environment: news.environment,
            name: news.name,
          })).config);
      return attributes(news, config?.root);
    }),

    delete: ({ olds, output }) =>
      isBuiltIn(olds)
        ? Effect.void
        : ignoreNotFound(deleteConfig({ project: output.project, config: output.name })),
  });
