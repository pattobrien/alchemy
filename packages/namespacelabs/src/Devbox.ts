import {
  create,
  createFromTemplate,
  expire,
  fetch,
  list,
  update,
  type AccessMode,
  type BlueprintSpecEnvVar,
  type BlueprintSpecSessionSpec,
  type DevBox,
  type EphemeralSpec,
  type Features,
  type HttpAccessMode,
  type InstanceShape,
  type Integrations,
  type NetworkPolicySpec,
  type PersistenceMode,
  type PortSpec,
  type ServiceSpec,
  type UpdateRequest,
  type VersionControlSpec,
} from "@distilled.cloud/namespacelabs/private_devbox";
import { Unowned } from "alchemy/AdoptPolicy";
import { deepEqual, isResolved } from "alchemy/Diff";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  createInternalLabels,
  hasAlchemyLabels,
  isAlchemyLabelled,
  toLabels,
  userLabels,
} from "./Labels.ts";
import type { Providers } from "./Providers.ts";

export interface DevboxProps {
  /**
   * Devbox name, unique per user; the `devbox` CLI addresses the box by it.
   * Changing it replaces the devbox.
   *
   * @default a name derived from the logical id
   */
  name?: string;

  /**
   * Id of a {@link DevboxTemplate} to create from. The template supplies
   * every setting except `name`, `site`, `accessMode`, `purpose` and
   * `labels`; the other props are rejected at plan time.
   */
  template?: string;

  /**
   * Image reference. Exclusive with `imageName`.
   */
  image?: string;

  /**
   * Image name, resolved to a reference at creation. Exclusive with `image`.
   */
  imageName?: string;

  /**
   * Machine shape. Updates in place; the new shape applies on the next start.
   */
  shape?: InstanceShape;

  /**
   * Site the devbox runs in, such as `iad`.
   */
  site?: string;

  /**
   * Persistent volume size in gigabytes. Grows in place on the next restart;
   * shrinking replaces the devbox.
   */
  volumeSizeGb?: number;

  /**
   * Cache volume size in gigabytes.
   */
  cacheVolumeSizeGb?: number;

  /**
   * Repository to check out into the workspace.
   */
  versionControl?: VersionControlSpec;

  /**
   * Minimum time the devbox stays up after it was last busy, as a duration
   * like `"300s"`. Updates in place.
   */
  busyEnsureMinimumDuration?: string;

  /**
   * `USER_PRIVATE` or `TENANT_WIDE`.
   */
  accessMode?: AccessMode | (string & {});

  /**
   * Who may open the devbox's `devbox.so` URLs: `{ owner: {} }`,
   * `{ tenant: {} }` or `{ public: {} }`. Updates in place.
   */
  httpAccessMode?: HttpAccessMode;

  /**
   * Terminal sessions started with the devbox.
   */
  sessions?: BlueprintSpecSessionSpec[];

  /**
   * Tailscale and Claude integrations. Updates in place.
   */
  integrations?: Integrations;

  /**
   * Why the devbox exists, shown in the Namespace UI.
   */
  purpose?: string;

  /**
   * Marks the devbox ephemeral and sets how long it is kept after it stops.
   */
  ephemeral?: EphemeralSpec;

  /**
   * Run the devbox privileged. Updates in place on the next restart.
   */
  privileged?: boolean;

  /**
   * Environment variables merged over the image's.
   */
  environment?: BlueprintSpecEnvVar[];

  /**
   * Egress policy. Updates in place on the next restart.
   */
  networkPolicy?: NetworkPolicySpec;

  /**
   * Ports to forward or expose as HTTP ingress.
   */
  ports?: PortSpec[];

  /**
   * Labels on the devbox. Alchemy adds its ownership labels.
   */
  labels?: Record<string, string>;

  /**
   * Script run once when the devbox is first initialized.
   */
  initScript?: string;

  /**
   * `PERSISTENCE_MODE_WORKSPACE` or `PERSISTENCE_MODE_WHOLE_SYSTEM`.
   */
  persistenceMode?: PersistenceMode | (string & {});

  /**
   * Long-running services started with the devbox.
   */
  services?: ServiceSpec[];

  /**
   * Devbox features to enable.
   */
  features?: Features;

  /**
   * Start the devbox as soon as it is created.
   *
   * @default false
   */
  activate?: boolean;
}

export interface DevboxAttributes {
  /**
   * Server-assigned devbox id.
   */
  id: string;

  /**
   * Devbox name.
   */
  name: string;

  createdAt?: string;
  site?: string;
  imageRef?: string;
  shape?: InstanceShape;

  /**
   * Name of the persistent volume, `devbox-<id>`.
   */
  volumeName?: string;
  volumeSizeGb?: number;
  cacheVolumeSizeGb?: number;
  workspaceDir?: string;
  mainUser?: string;
  accessMode?: AccessMode | (string & {});
  httpAccessMode?: HttpAccessMode;
  busyEnsureMinimumDuration?: string;
  integrations?: Integrations;
  networkPolicy?: NetworkPolicySpec;
  versionControl?: VersionControlSpec;
  purpose?: string;
  ephemeral?: EphemeralSpec;

  /**
   * User labels, without Alchemy's ownership labels.
   */
  labels: Record<string, string>;

  /**
   * Compute instance started by `activate`, when it was set.
   */
  instanceId?: string;
}

export interface Devbox extends Resource<
  "NamespaceLabs.Devbox",
  DevboxProps,
  DevboxAttributes,
  never,
  Providers
> {}

/**
 * A Namespace devbox: a persistent development machine with its own volume
 * that starts on demand and stops when idle.
 *
 * Create one from a {@link DevboxTemplate} with `template`, or describe it in
 * full. Shape, idle time, integrations, volume growth, privilege, network
 * policy and HTTP access update in place; everything else replaces the
 * devbox, which drops its volume. Alchemy labels the devbox it creates and
 * refuses one with the same name that it did not create unless deployed with
 * `adopt(true)`.
 *
 * ### Creating a Devbox from a Template
 * **Example:** Agent Box
 * ```typescript
 * const box = yield* NamespaceLabs.Devbox("simlab", {
 *   name: "simlab-2",
 *   template: agents.id,
 *   purpose: "iOS simulator lab",
 * });
 * ```
 *
 * ### Describing a Devbox in Full
 * **Example:** Linux Box with a Repository
 * ```typescript
 * yield* NamespaceLabs.Devbox("api", {
 *   imageName: "builtin:default",
 *   shape: { virtualCpu: 4, memoryMegabytes: 8192, machineArch: "amd64", os: "linux" },
 *   volumeSizeGb: 50,
 *   versionControl: { gitRepository: "github.com/acme/api" },
 *   busyEnsureMinimumDuration: "600s",
 * });
 * ```
 *
 * @resource
 * @product NamespaceLabs
 */
export const Devbox = Resource<Devbox>("NamespaceLabs.Devbox");

const gb = (value: string | undefined) => (value === undefined ? undefined : Number(value));

const toAttributes = (devbox: DevBox, instanceId: string | undefined): DevboxAttributes => ({
  id: devbox.id!,
  name: devbox.name!,
  createdAt: devbox.createdAt,
  site: devbox.site,
  imageRef: devbox.imageRef,
  shape: devbox.instanceShape,
  volumeName: devbox.volumeName,
  volumeSizeGb: gb(devbox.volumeSizeGb),
  cacheVolumeSizeGb: gb(devbox.cacheVolumeSizeGb),
  workspaceDir: devbox.workspaceDir,
  mainUser: devbox.mainUser,
  accessMode: devbox.accessMode,
  httpAccessMode: devbox.httpAccessMode,
  busyEnsureMinimumDuration: devbox.busyEnsureMinimumDuration,
  integrations: devbox.integrations,
  networkPolicy: devbox.networkPolicy,
  versionControl: devbox.versionControl,
  purpose: devbox.documentedPurpose,
  ephemeral: devbox.ephemeral,
  labels: userLabels(devbox.labels),
  instanceId,
});

const notFound = () => Effect.succeed(undefined);

const byId = (id: string) =>
  fetch({ id }).pipe(
    Effect.map((response) => response.devbox),
    Effect.catchTag("NotFound", notFound),
  );

const byName = (name: string) =>
  fetch({ name }).pipe(
    Effect.map((response) => response.devbox),
    Effect.catchTag("NotFound", notFound),
  );

const devboxName = Effect.fn(function* (id: string, ...candidates: (string | undefined)[]) {
  return (
    candidates.find((candidate) => candidate !== undefined) ??
    (yield* createPhysicalName({ id, maxLength: 63, lowercase: true }))
  );
});

const UPDATE_IN_PLACE = [
  "shape",
  "busyEnsureMinimumDuration",
  "integrations",
  "volumeSizeGb",
  "privileged",
  "networkPolicy",
  "httpAccessMode",
] as const satisfies ReadonlyArray<keyof DevboxProps>;

const TEMPLATE_PROPS = [
  "name",
  "template",
  "site",
  "accessMode",
  "purpose",
  "labels",
  "activate",
] as const satisfies ReadonlyArray<keyof DevboxProps>;

const replacingKeys = (news: DevboxProps, olds: DevboxProps) =>
  (Object.keys({ ...news, ...olds }) as (keyof DevboxProps)[]).filter(
    (key) =>
      key !== "activate" &&
      !UPDATE_IN_PLACE.includes(key as (typeof UPDATE_IN_PLACE)[number]) &&
      !deepEqual(news[key], olds[key]),
  );

const shrinks = (news: DevboxProps, olds: DevboxProps) =>
  news.volumeSizeGb !== undefined &&
  olds.volumeSizeGb !== undefined &&
  news.volumeSizeGb < olds.volumeSizeGb;

/**
 * A Devbox with `template` also set props the template supplies.
 */
export class DevboxTemplateConflict extends Data.TaggedError(
  "NamespaceLabs.DevboxTemplateConflict",
)<{
  readonly message: string;
  readonly keys: ReadonlyArray<string>;
}> {}

const templateConflict = (keys: ReadonlyArray<string>) =>
  new DevboxTemplateConflict({
    keys,
    message: `A Devbox created from a template takes only ${TEMPLATE_PROPS.join(", ")}; remove ${keys.join(", ")} or drop \`template\`.`,
  });

const templateConflicts = (props: DevboxProps) =>
  props.template === undefined
    ? []
    : (Object.keys(props) as (keyof DevboxProps)[]).filter(
        (key) =>
          props[key] !== undefined &&
          !TEMPLATE_PROPS.includes(key as (typeof TEMPLATE_PROPS)[number]),
      );

const updateFields = (news: DevboxProps, live: DevBox): Omit<UpdateRequest, "name"> => {
  const fields: Omit<UpdateRequest, "name"> = {};
  if (news.shape !== undefined && !deepEqual(news.shape, live.instanceShape)) {
    fields.instanceShape = news.shape;
  }
  if (
    news.busyEnsureMinimumDuration !== undefined &&
    news.busyEnsureMinimumDuration !== live.busyEnsureMinimumDuration
  ) {
    fields.busyEnsureMinimumDuration = news.busyEnsureMinimumDuration;
  }
  if (news.integrations !== undefined && !deepEqual(news.integrations, live.integrations)) {
    fields.integrations = news.integrations;
  }
  if (news.volumeSizeGb !== undefined && news.volumeSizeGb > (gb(live.volumeSizeGb) ?? 0)) {
    fields.volumeSizeGb = String(news.volumeSizeGb);
  }
  if (news.privileged !== undefined && news.privileged !== live.spec?.privileged) {
    fields.privileged = news.privileged;
  }
  if (news.networkPolicy !== undefined && !deepEqual(news.networkPolicy, live.networkPolicy)) {
    fields.networkPolicy = news.networkPolicy;
  }
  if (news.httpAccessMode !== undefined && !deepEqual(news.httpAccessMode, live.httpAccessMode)) {
    fields.httpAccessMode = news.httpAccessMode;
  }
  return fields;
};

export const DevboxProvider = () =>
  Provider.succeed(Devbox, {
    stables: ["id", "name", "volumeName"],

    list: () =>
      list.items({}).pipe(
        Stream.filter(
          (devbox) => isAlchemyLabelled(devbox.labels) && devbox.destroyedAt === undefined,
        ),
        Stream.map((devbox) => toAttributes(devbox, undefined)),
        Stream.runCollect,
      ),

    diff: Effect.fn(function* ({ news, olds }) {
      if (!isResolved(news)) return;
      const conflicts = templateConflicts(news);
      if (conflicts.length > 0) return yield* templateConflict(conflicts);
      if (replacingKeys(news, olds).length > 0 || shrinks(news, olds)) {
        return { action: "replace" as const };
      }
    }),

    read: Effect.fn(function* ({ id, olds, output }) {
      const live =
        (output?.id !== undefined ? yield* byId(output.id) : undefined) ??
        (yield* byName(yield* devboxName(id, output?.name, olds.name)));
      if (live === undefined || live.destroyedAt !== undefined) return undefined;
      const attributes = toAttributes(live, output?.instanceId);
      return (yield* hasAlchemyLabels(id, live.labels)) ? attributes : Unowned(attributes);
    }),

    reconcile: Effect.fn(function* ({ id, news, output }) {
      const name = yield* devboxName(id, news.name, output?.name);
      const labels = [...toLabels(news.labels), ...(yield* createInternalLabels(id))];
      const live = yield* byName(name);
      if (live === undefined || live.destroyedAt !== undefined) {
        const created =
          news.template !== undefined
            ? yield* createFromTemplate({
                name,
                templateId: news.template,
                activate: news.activate,
                documentedPurpose: news.purpose,
                overrides: { site: news.site, accessMode: news.accessMode },
                labels,
              })
            : yield* create({
                name,
                imageRef: news.image,
                imageName: news.imageName,
                instanceShape: news.shape,
                site: news.site,
                volumeSizeGb:
                  news.volumeSizeGb === undefined ? undefined : String(news.volumeSizeGb),
                cacheVolumeSizeGb:
                  news.cacheVolumeSizeGb === undefined ? undefined : String(news.cacheVolumeSizeGb),
                versionControl: news.versionControl,
                busyEnsureMinimumDuration: news.busyEnsureMinimumDuration,
                accessMode: news.accessMode,
                sessions: news.sessions,
                integrations: news.integrations,
                documentedPurpose: news.purpose,
                ephemeral: news.ephemeral,
                privileged: news.privileged,
                environment: news.environment,
                networkPolicy: news.networkPolicy,
                ports: news.ports,
                labels,
                initScript: news.initScript,
                persistenceMode: news.persistenceMode,
                services: news.services,
                features: news.features,
                activate: news.activate,
              });
        const devbox =
          news.httpAccessMode === undefined
            ? created.devbox!
            : (yield* update({ name, httpAccessMode: news.httpAccessMode })).devbox!;
        return toAttributes(devbox, created.instanceId);
      }
      const fields = updateFields(news, live);
      const devbox =
        Object.keys(fields).length === 0 ? live : (yield* update({ name, ...fields })).devbox!;
      return toAttributes(devbox, output?.instanceId);
    }),

    delete: ({ output }) =>
      expire({ name: output.name }).pipe(
        Effect.asVoid,
        Effect.catchTag("NotFound", () => Effect.void),
      ),
  });
