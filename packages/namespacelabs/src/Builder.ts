import {
  ensureBuildInstance,
  getBuilderConfiguration,
  type Authentication,
  type Encapsulation,
  type EnsureBuildInstanceResponse,
  type GetBuilderConfigurationResponse,
  type InstanceShape,
} from "@distilled.cloud/namespacelabs/builder";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";

export interface BuilderProps {
  /**
   * Build platform: `linux/amd64` or `linux/arm64`. Changing it replaces the
   * builder.
   */
  platform: "linux/amd64" | "linux/arm64" | (string & {});

  /**
   * Builder name, up to 32 characters matching `^[a-z][a-z0-9_-]*$`. Named
   * builders have their own cache; unnamed ones share the platform default.
   * Changing it replaces the builder.
   */
  name?: string;

  /**
   * Machine shape of the build instance.
   */
  shape?: InstanceShape;

  /**
   * Build cache size in megabytes.
   */
  cacheSizeMb?: number;

  /**
   * Cache tag shared between differently named builders.
   */
  cacheIdentity?: string;
}

export interface BuilderAttributes {
  platform: string;
  name?: string;

  /**
   * Compute instance currently backing the builder.
   */
  instanceId?: string;

  /**
   * BuildKit endpoint of the running instance, as `ensureBuildInstance`
   * reports it.
   */
  endpoint?: string;
  encapsulation?: Encapsulation;
  authentication?: Authentication;

  /**
   * When the backing instance expires. Namespace starts a new one on the next
   * build.
   */
  deadline?: string;

  /**
   * Stable BuildKit endpoint for `docker buildx` (`host:port`), and the same
   * with a `tcp://` prefix.
   */
  buildkitEndpoint?: string;
  fullBuildkitEndpoint?: string;
  shape?: InstanceShape;
  cacheSizeMb?: number;

  /**
   * PEM of the CA that signs the builder endpoint.
   */
  serverCaPem?: string;
}

export interface Builder extends Resource<
  "NamespaceLabs.Builder",
  BuilderProps,
  BuilderAttributes,
  never,
  Providers
> {}

/**
 * A Namespace remote builder: the BuildKit instance that `nsc docker buildx
 * setup` and runner profiles with `builderMode: "USE_REMOTE_BUILDER"` build
 * on.
 *
 * Builders are not stored objects in Namespace. Each deploy ensures an
 * instance for the platform is running and returns its endpoints; the
 * instance expires on its own after its `deadline` and Namespace starts the
 * next one on demand with the same name, shape and cache. Destroying the
 * resource only forgets it.
 *
 * ### Warming a Builder
 * **Example:** amd64 Builder with a Larger Cache
 * ```typescript
 * const builder = yield* NamespaceLabs.Builder("amd64", {
 *   platform: "linux/amd64",
 *   name: "ci",
 *   shape: { virtualCpu: 16, memoryMegabytes: 32768 },
 *   cacheSizeMb: 100_000,
 * });
 * // builder.fullBuildkitEndpoint -> "tcp://....build.namespaceapis.com:443"
 * ```
 *
 * @resource
 * @product NamespaceLabs
 */
export const Builder = Resource<Builder>("NamespaceLabs.Builder");

const mb = (value: string | undefined) => (value === undefined ? undefined : Number(value));

const toAttributes = (
  props: BuilderProps,
  ensured: EnsureBuildInstanceResponse | undefined,
  config: GetBuilderConfigurationResponse,
): BuilderAttributes => ({
  platform: props.platform,
  name: props.name,
  instanceId: ensured?.instanceId,
  endpoint: ensured?.endpoint,
  encapsulation: ensured?.encapsulation,
  authentication: ensured?.authentication,
  deadline: ensured?.deadline,
  buildkitEndpoint: config.buildkitEndpoint,
  fullBuildkitEndpoint: config.fullBuildkitEndpoint,
  shape: config.shape,
  cacheSizeMb: mb(config.cacheSizeMb),
  serverCaPem: config.serverCaPem,
});

const configuration = (props: BuilderProps) =>
  getBuilderConfiguration({
    platform: props.platform,
    builderName: props.name,
    builderShape: props.shape,
    cacheSizeMb: props.cacheSizeMb === undefined ? undefined : String(props.cacheSizeMb),
    skipBuilderPreSpawn: true,
  });

export const BuilderProvider = () =>
  Provider.succeed(Builder, {
    stables: ["platform", "name", "buildkitEndpoint", "fullBuildkitEndpoint"],

    nuke: { skip: true },

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && (news.platform !== olds.platform || news.name !== olds.name)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds, output }) =>
      configuration(olds).pipe(
        Effect.map((config) => ({
          ...toAttributes(olds, undefined, config),
          instanceId: output?.instanceId,
          endpoint: output?.endpoint,
          encapsulation: output?.encapsulation,
          authentication: output?.authentication,
          deadline: output?.deadline,
        })),
      ),

    reconcile: Effect.fn(function* ({ news }) {
      const ensured = yield* ensureBuildInstance({
        platform: news.platform,
        experimental: {
          builderName: news.name,
          shape: news.shape,
          cacheSizeMb: news.cacheSizeMb === undefined ? undefined : String(news.cacheSizeMb),
          cacheIdentity: news.cacheIdentity,
        },
      });
      return toAttributes(news, ensured, yield* configuration(news));
    }),

    delete: () => Effect.void,
  });
