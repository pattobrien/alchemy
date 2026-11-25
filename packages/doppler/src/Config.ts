import {
  configsInheritable,
  configsInherits,
  createConfig,
  deleteConfig,
  getConfig,
  listConfigs,
} from "@distilled.cloud/doppler";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import { findInPages, ignoreNotFound, orUndefined } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface ConfigReference {
  /**
   * Slug of the project the config belongs to.
   */
  project: string;

  /**
   * Config name.
   */
  config: string;
}

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

  /**
   * Whether other configs can inherit this config's secrets. An inheritable
   * config cannot itself inherit. Unset leaves the live setting alone.
   */
  inheritable?: boolean;

  /**
   * Inheritable configs whose secrets this config inherits, in the order
   * Doppler applies them. Unset leaves the live list alone. A branch config
   * starts with its root config's list and takes the root config's changes
   * while the two lists match.
   */
  inherits?: readonly ConfigReference[];
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

  /**
   * Whether other configs can inherit this config's secrets.
   */
  inheritable: boolean;

  /**
   * Configs whose secrets this config inherits.
   */
  inherits: ConfigReference[];
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
 * Destroying a root or personal config turns off the `inheritable` and
 * `inherits` settings it declared.
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
 * ### Config Inheritance
 * **Example:** Inherit a Shared Config
 * ```typescript
 * const shared = yield* Doppler.Config("shared-prd", {
 *   project: "shared",
 *   environment: "prd",
 *   name: "prd",
 *   inheritable: true,
 * });
 * yield* Doppler.Config("api-prd", {
 *   project: "api",
 *   environment: "prd",
 *   name: "prd",
 *   inherits: [{ project: shared.project, config: shared.name }],
 * });
 * ```
 *
 * @resource
 * @product Doppler
 */
export const Config = Resource<Config>("Doppler.Config");

const isBuiltIn = ({ environment, name }: ConfigProps) =>
  name === environment || name === `${environment}_personal`;

// a token scoped to some environments gets a 400, not a 404, for a config it cannot see,
// so a missing branch config is found by listing its environment
const find = ({ project, environment, name }: ConfigProps) =>
  orUndefined(
    findInPages(
      (page) =>
        listConfigs({ project, environment, ...page }).pipe(
          Effect.map((response) => response.configs),
        ),
      (config) => config.name === name,
    ),
  );

interface LiveConfig {
  root?: boolean;
  inheritable?: boolean;
  inherits?: readonly { project?: string; config?: string }[];
}

type Inheritance = Pick<ConfigAttributes, "inheritable" | "inherits">;

const inheritance = (live: LiveConfig | undefined): Inheritance => ({
  inheritable: live?.inheritable ?? false,
  inherits: (live?.inherits ?? []).map((ref) => ({ project: ref.project!, config: ref.config! })),
});

const attributes = (props: ConfigProps, live: LiveConfig | undefined): ConfigAttributes => ({
  project: props.project,
  environment: props.environment,
  name: props.name,
  root: live?.root ?? false,
  ...inheritance(live),
});

const sameReferences = (a: readonly ConfigReference[], b: readonly ConfigReference[]) =>
  a.length === b.length &&
  a.every((ref, i) => ref.project === b[i].project && ref.config === b[i].config);

// an inheritable config cannot inherit, so the side being turned off goes first
const inherit = Effect.fn(function* (props: ConfigProps, live: Inheritance) {
  const target = { project: props.project, config: props.name };
  const inheritable =
    props.inheritable === undefined || props.inheritable === live.inheritable
      ? []
      : [configsInheritable({ ...target, inheritable: props.inheritable })];
  const inherits =
    props.inherits === undefined || sameReferences(props.inherits, live.inherits)
      ? []
      : [configsInherits({ ...target, inherits: [...props.inherits] })];
  let current = live;
  for (const write of props.inheritable
    ? [...inherits, ...inheritable]
    : [...inheritable, ...inherits]) {
    current = inheritance((yield* write).config);
  }
  return current;
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
      find(olds).pipe(
        Effect.map((config) => {
          if (config === undefined) return undefined;
          const attrs = attributes(olds, config);
          return isBuiltIn(olds) ? attrs : Unowned(attrs);
        }),
      ),

    reconcile: Effect.fn(function* ({ news }) {
      const config = isBuiltIn(news)
        ? (yield* getConfig({ project: news.project, config: news.name })).config
        : ((yield* find(news)) ??
          (yield* createConfig({
            project: news.project,
            environment: news.environment,
            name: news.name,
          })).config);
      const live = attributes(news, config);
      return { ...live, ...(yield* inherit(news, live)) };
    }),

    delete: ({ olds, output }) =>
      isBuiltIn(olds)
        ? ignoreNotFound(
            inherit(
              {
                ...olds,
                inheritable: olds.inheritable ? false : undefined,
                inherits: olds.inherits?.length ? [] : undefined,
              },
              output,
            ),
          )
        : ignoreNotFound(deleteConfig({ project: output.project, config: output.name })),
  });
