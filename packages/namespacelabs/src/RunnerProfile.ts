import {
  createProfile,
  deleteProfile,
  listProfiles,
  updateProfile,
  type AccessLevel,
  type BuilderMode,
  type CacheVolumeSettings,
  type CustomRunnerImageSpec,
  type InstanceShape,
  type NetworkPolicy,
  type RunnerProfileSpec,
  type RunnerProfileStatus,
  type RunnerProfileWithStatus,
} from "@distilled.cloud/namespacelabs/github_profile";
import { Unowned } from "alchemy/AdoptPolicy";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";

export interface RunnerProfileProps {
  /**
   * Unique alias within the workspace. Workflows select the profile with
   * `runs-on: namespace-profile-<tag>`. Changing it renames the profile in
   * place.
   */
  tag: string;

  /**
   * Human-readable description.
   */
  description?: string;

  /**
   * Base image label, such as `ubuntu-24.04` or a macOS image like
   * `goldengate`. `githubImage.listBaseImages` lists the valid values.
   */
  os?: string;

  /**
   * Machine shape: `virtualCpu`, `memoryMegabytes`, `machineArch` (`amd64`
   * or `arm64`) and `os` (`linux` or `macos`).
   */
  shape?: InstanceShape;

  /**
   * Cache volumes mounted into every runner of this profile.
   */
  cacheVolumes?: CacheVolumeSettings[];

  /**
   * How `docker build` steps run: `USE_REMOTE_BUILDER`, `USE_LOCAL_CACHE`
   * or `NO_CACHING`.
   *
   * @default "BUILDER_MODE_UNSPECIFIED"
   */
  builderMode?: BuilderMode | (string & {});

  /**
   * Egress policy for the runners.
   */
  networkPolicy?: NetworkPolicy;

  /**
   * Which Namespace features a job may use: `ACCESS_LEVEL_PERMISSIVE`,
   * `ACCESS_LEVEL_LIMITED` or `ACCESS_LEVEL_RESTRICTED`.
   *
   * @default "ACCESS_LEVEL_PERMISSIVE"
   */
  accessLevel?: AccessLevel | (string & {});

  /**
   * Swap size in megabytes.
   */
  swapSizeMb?: number;

  /**
   * Emoji shown next to the profile in the Namespace UI.
   */
  emoji?: string;

  /**
   * Custom runner image built on top of the base image, as apt packages or a
   * Dockerfile.
   */
  customImage?: CustomRunnerImageSpec;

  /**
   * Experimental feature flags.
   */
  experimentalFeatures?: string[];
}

export interface RunnerProfileAttributes {
  /**
   * Server-assigned profile id (`ghpf_...`).
   */
  profileId: string;

  /**
   * The profile tag.
   */
  tag: string;

  /**
   * The `runs-on` label that selects this profile: `namespace-profile-<tag>`.
   */
  runsOn: string;

  /**
   * Version, incremented on every update.
   */
  version?: string;

  createdAt?: string;
  updatedAt?: string;
  description?: string;
  os?: string;
  shape?: InstanceShape;
  cacheVolumes?: CacheVolumeSettings[];
  builderMode?: BuilderMode | (string & {});
  networkPolicy?: NetworkPolicy;
  accessLevel?: AccessLevel | (string & {});
  swapSizeMb?: number;
  emoji?: string;
  customImage?: CustomRunnerImageSpec;
  experimentalFeatures?: string[];

  /**
   * Build status of the custom runner image, when one is configured.
   */
  status?: RunnerProfileStatus;
}

export interface RunnerProfile extends Resource<
  "NamespaceLabs.RunnerProfile",
  RunnerProfileProps,
  RunnerProfileAttributes,
  never,
  Providers
> {}

/**
 * A Namespace GitHub Actions runner profile: the machine shape, base image,
 * cache volumes and policies that a `runs-on: namespace-profile-<tag>` job
 * gets.
 *
 * Every field updates in place; the profile keeps its id and version counts
 * up. A profile that already exists with the same tag is never taken over
 * silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a Runner Profile
 * **Example:** Linux Runners with a Remote Builder
 * ```typescript
 * const linux = yield* NamespaceLabs.RunnerProfile("linux", {
 *   tag: "linux-default",
 *   os: "ubuntu-24.04",
 *   shape: { virtualCpu: 4, memoryMegabytes: 8192, machineArch: "amd64", os: "linux" },
 *   builderMode: "USE_REMOTE_BUILDER",
 *   cacheVolumes: [
 *     {
 *       volumeSizeGb: 20,
 *       bundledContainerCache: true,
 *       bundledGitMirror: true,
 *       bundledRunnerToolsCache: true,
 *       bundledRunnerActionsCache: true,
 *       allowCommitFromBranch: ["main"],
 *     },
 *   ],
 * });
 * // linux.runsOn === "namespace-profile-linux-default"
 * ```
 *
 * ### macOS Runners
 * **Example:** Apple Silicon Profile
 * ```typescript
 * yield* NamespaceLabs.RunnerProfile("mac", {
 *   tag: "mac",
 *   os: "goldengate",
 *   shape: { virtualCpu: 6, memoryMegabytes: 14336, machineArch: "arm64", os: "macos" },
 *   cacheVolumes: [{ volumeSizeGb: 50, bundledGitMirror: true, bundledRunnerToolsCache: true }],
 * });
 * ```
 *
 * @resource
 * @product NamespaceLabs
 */
export const RunnerProfile = Resource<RunnerProfile>("NamespaceLabs.RunnerProfile");

const runsOn = (tag: string) => `namespace-profile-${tag}`;

const toSpec = (props: RunnerProfileProps): RunnerProfileSpec => ({
  tag: props.tag,
  description: props.description,
  os: props.os,
  instanceShape: props.shape,
  cacheVolumeSettings: props.cacheVolumes,
  builderMode: props.builderMode,
  networkPolicy: props.networkPolicy,
  accessLevel: props.accessLevel,
  swapSizeMb: props.swapSizeMb,
  emoji: props.emoji,
  customRunnerImageSpec: props.customImage,
  experimentalFeatures: props.experimentalFeatures,
});

const toAttributes = (profile: RunnerProfileWithStatus): RunnerProfileAttributes => {
  const spec = profile.spec ?? {};
  const tag = spec.tag ?? "";
  return {
    profileId: profile.profileId!,
    tag,
    runsOn: runsOn(tag),
    version: profile.version,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    description: spec.description,
    os: spec.os,
    shape: spec.instanceShape,
    cacheVolumes: spec.cacheVolumeSettings,
    builderMode: spec.builderMode,
    networkPolicy: spec.networkPolicy,
    accessLevel: spec.accessLevel,
    swapSizeMb: spec.swapSizeMb,
    emoji: spec.emoji,
    customImage: spec.customRunnerImageSpec,
    experimentalFeatures: spec.experimentalFeatures,
    status: profile.status,
  };
};

const profiles = listProfiles({}).pipe(Effect.map((response) => response.profiles ?? []));

const find = (match: (profile: RunnerProfileWithStatus) => boolean) =>
  profiles.pipe(Effect.map((all) => all.find(match)));

const byId = (profileId: string) => find((profile) => profile.profileId === profileId);
const byTag = (tag: string) => find((profile) => profile.spec?.tag === tag);

const isUserCreated = (profile: RunnerProfileWithStatus) => profile.createdAt !== undefined;

export const RunnerProfileProvider = () =>
  Provider.succeed(RunnerProfile, {
    stables: ["profileId"],

    list: () => profiles.pipe(Effect.map((all) => all.filter(isUserCreated).map(toAttributes))),

    read: Effect.fn(function* ({ olds, output }) {
      if (output?.profileId !== undefined) {
        const own = yield* byId(output.profileId);
        if (own !== undefined) return toAttributes(own);
      }
      const named = yield* byTag(olds.tag);
      return named === undefined ? undefined : Unowned(toAttributes(named));
    }),

    reconcile: Effect.fn(function* ({ news, output }) {
      const spec = toSpec(news);
      const live =
        (output?.profileId !== undefined ? yield* byId(output.profileId) : undefined) ??
        (yield* byTag(news.tag));
      if (live === undefined) {
        const created = yield* createProfile({ spec });
        return toAttributes(created.profile!);
      }
      const updated = yield* updateProfile({
        profileId: live.profileId,
        spec,
        updateVersion: live.version,
      });
      return toAttributes(updated.profile!);
    }),

    delete: ({ output }) =>
      deleteProfile({ profileId: output.profileId }).pipe(
        Effect.asVoid,
        Effect.catchTag("NotFound", () => Effect.void),
      ),
  });
