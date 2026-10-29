import {
  createTemplate,
  expireTemplate,
  fetchTemplate,
  listTemplates,
  updateTemplate,
  type AccessMode,
  type BlueprintSpecEnvVar,
  type BlueprintSpecSessionSpec,
  type CreateTemplateRequestExperimental,
  type DevboxTemplate as DevboxTemplateRecord,
  type DevboxTemplateSpec,
  type DevboxTemplateSpecExperimental,
  type DevboxTemplateSpecInstanceSpec,
  type DevboxTemplateSpecType,
  type EphemeralSpec,
  type Features,
  type Integrations,
  type NetworkPolicySpec,
  type PersistenceMode,
  type PortSpec,
  type ServiceSpec,
  type VersionControlSpec,
} from "@distilled.cloud/namespacelabs/private_devbox";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Providers } from "./Providers.ts";

export interface DevboxTemplateProps {
  /**
   * Template name: 1-63 letters, digits or hyphens, not starting or ending
   * with a hyphen. `devbox create --blueprint <name>` and
   * {@link Devbox} `template` refer to it. Changing it replaces the template.
   */
  name: string;

  /**
   * Human-readable description.
   */
  description?: string;

  /**
   * Machine shape and, for Linux, the image: `{ shape, linux: { imageName } }`.
   */
  instance?: DevboxTemplateSpecInstanceSpec;

  /**
   * Site the devboxes run in, such as `iad`. `privateDevbox.metadata` lists
   * the sites and their platforms.
   */
  site?: string;

  /**
   * Marks devboxes from this template ephemeral and sets how long a stopped
   * one is kept, as a duration like `"3600s"`.
   */
  ephemeral?: EphemeralSpec;

  /**
   * Repository to check out into the workspace.
   */
  versionControl?: VersionControlSpec;

  /**
   * Environment variables, by value or from a tenant secret.
   */
  environment?: BlueprintSpecEnvVar[];

  /**
   * Minimum time a devbox stays up after it was last busy, as a duration
   * like `"300s"`.
   */
  busyEnsureMinimumDuration?: string;

  /**
   * Tailscale and Claude integrations.
   */
  integrations?: Integrations;

  /**
   * Egress policy.
   */
  networkPolicy?: NetworkPolicySpec;

  /**
   * Persistent volume size in gigabytes.
   */
  volumeSizeGb?: number;

  /**
   * Who can use devboxes from this template: `USER_PRIVATE` or `TENANT_WIDE`.
   */
  accessMode: AccessMode | (string & {});

  /**
   * Devbox features to enable. An empty `enabled` list disables all of them.
   */
  features?: Features;

  /**
   * Ports to forward or expose as HTTP ingress.
   */
  ports?: PortSpec[];

  /**
   * `TYPE_GENERAL`, or a managed type for Claude, Cursor or Devin.
   */
  type?: DevboxTemplateSpecType | (string & {});

  /**
   * Terminal sessions started in every devbox.
   */
  sessions?: BlueprintSpecSessionSpec[];

  /**
   * Script run once when a devbox is first initialized.
   */
  initScript?: string;

  /**
   * `PERSISTENCE_MODE_WORKSPACE` or `PERSISTENCE_MODE_WHOLE_SYSTEM`.
   */
  persistenceMode?: PersistenceMode | (string & {});

  /**
   * Long-running services started in every devbox.
   */
  services?: ServiceSpec[];

  /**
   * Devin, Cursor and Claude environment settings.
   */
  experimental?: DevboxTemplateSpecExperimental;

  /**
   * Integration credentials. Namespace stores them in the tenant vault and
   * never returns them, so they are sent on every deploy and cannot be
   * diffed.
   */
  credentials?: CreateTemplateRequestExperimental;
}

export interface DevboxTemplateAttributes {
  /**
   * Server-assigned template id, the `templateId` of
   * `privateDevbox.createFromTemplate`.
   */
  id: string;

  /**
   * Template name.
   */
  name: string;

  /**
   * Version, incremented on every update.
   */
  version?: string;

  createdAt?: string;
  updatedAt?: string;
  description?: string;
  instance?: DevboxTemplateSpecInstanceSpec;
  site?: string;
  ephemeral?: EphemeralSpec;
  versionControl?: VersionControlSpec;
  environment?: BlueprintSpecEnvVar[];
  busyEnsureMinimumDuration?: string;
  integrations?: Integrations;
  networkPolicy?: NetworkPolicySpec;
  volumeSizeGb?: number;
  accessMode?: AccessMode | (string & {});
  features?: Features;
  ports?: PortSpec[];
  type?: DevboxTemplateSpecType | (string & {});
  sessions?: BlueprintSpecSessionSpec[];
  initScript?: string;
  persistenceMode?: PersistenceMode | (string & {});
  services?: ServiceSpec[];
  experimental?: DevboxTemplateSpecExperimental;
}

export interface DevboxTemplate extends Resource<
  "NamespaceLabs.DevboxTemplate",
  DevboxTemplateProps,
  DevboxTemplateAttributes,
  never,
  Providers
> {}

/**
 * A Namespace devbox template (a "blueprint" in the `devbox` CLI): the shape,
 * image, volume, repository and integrations every devbox created from it
 * starts with.
 *
 * Everything but `name` updates in place. A template that already exists
 * with the same name is never taken over silently: deploy it with
 * `adopt(true)` to manage it.
 *
 * ### Creating a Template
 * **Example:** macOS Agents
 * ```typescript
 * const agents = yield* NamespaceLabs.DevboxTemplate("agents", {
 *   name: "macos-agents",
 *   description: "Apple Silicon boxes for coding agents",
 *   instance: {
 *     shape: { virtualCpu: 6, memoryMegabytes: 14336, machineArch: "arm64", os: "macos" },
 *   },
 *   site: "iad",
 *   volumeSizeGb: 150,
 *   accessMode: "TENANT_WIDE",
 *   busyEnsureMinimumDuration: "300s",
 * });
 *
 * yield* NamespaceLabs.Devbox("box", { template: agents.id });
 * ```
 *
 * @resource
 * @product NamespaceLabs
 */
export const DevboxTemplate = Resource<DevboxTemplate>("NamespaceLabs.DevboxTemplate");

const toSpec = (props: DevboxTemplateProps): DevboxTemplateSpec => ({
  name: props.name,
  description: props.description,
  instance: props.instance,
  site: props.site,
  ephemeral: props.ephemeral,
  versionControl: props.versionControl,
  environment: props.environment,
  busyEnsureMinimumDuration: props.busyEnsureMinimumDuration,
  integrations: props.integrations,
  networkPolicy: props.networkPolicy,
  volumeSizeGb: props.volumeSizeGb === undefined ? undefined : String(props.volumeSizeGb),
  accessMode: props.accessMode,
  features: props.features,
  ports: props.ports,
  type: props.type,
  sessions: props.sessions,
  initScript: props.initScript,
  persistenceMode: props.persistenceMode,
  services: props.services,
  experimental: props.experimental,
});

const toAttributes = (template: DevboxTemplateRecord): DevboxTemplateAttributes => {
  const spec = template.spec ?? {};
  return {
    id: template.id!,
    name: spec.name ?? "",
    version: template.version,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    description: spec.description,
    instance: spec.instance,
    site: spec.site,
    ephemeral: spec.ephemeral,
    versionControl: spec.versionControl,
    environment: spec.environment,
    busyEnsureMinimumDuration: spec.busyEnsureMinimumDuration,
    integrations: spec.integrations,
    networkPolicy: spec.networkPolicy,
    volumeSizeGb: spec.volumeSizeGb === undefined ? undefined : Number(spec.volumeSizeGb),
    accessMode: spec.accessMode,
    features: spec.features,
    ports: spec.ports,
    type: spec.type,
    sessions: spec.sessions,
    initScript: spec.initScript,
    persistenceMode: spec.persistenceMode,
    services: spec.services,
    experimental: spec.experimental,
  };
};

const byName = (name: string) =>
  fetchTemplate({ name }).pipe(
    Effect.map((response) => response.template),
    Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
  );

export const DevboxTemplateProvider = () =>
  Provider.succeed(DevboxTemplate, {
    stables: ["id", "name"],

    list: () =>
      listTemplates.items({}).pipe(
        Stream.runCollect,
        Effect.map((templates) => templates.map(toAttributes)),
      ),

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && news.name !== olds.name ? { action: "replace" as const } : undefined,
      ),

    read: Effect.fn(function* ({ olds, output }) {
      const live = yield* byName(output?.name ?? olds.name);
      if (live === undefined) return undefined;
      const attributes = toAttributes(live);
      return output?.id === live.id ? attributes : Unowned(attributes);
    }),

    reconcile: Effect.fn(function* ({ news, output }) {
      const spec = toSpec(news);
      const live = yield* byName(news.name);
      if (live === undefined) {
        const created = yield* createTemplate({ spec, experimental: news.credentials });
        return toAttributes(created.template!);
      }
      const updated = yield* updateTemplate({
        id: output?.id ?? live.id,
        spec,
        experimental: news.credentials,
      });
      return toAttributes(updated.template!);
    }),

    delete: ({ output }) =>
      expireTemplate({ id: output.id }).pipe(
        Effect.asVoid,
        Effect.catchTag("NotFound", () => Effect.void),
      ),
  });
