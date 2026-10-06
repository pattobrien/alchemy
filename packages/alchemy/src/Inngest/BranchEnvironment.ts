import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { makeBranchEnvironmentApi } from "./BranchEnvironmentApi.ts";
import type { Providers } from "./Providers.ts";

export interface BranchEnvironmentProps {
  /**
   * Name of the branch environment. Bind the same value into the app as
   * `INNGEST_ENV` so its first sync creates the environment.
   * If omitted, a unique name is generated from the app, stage, logical ID and
   * instance, so a replacement or a redeploy after destroy starts a fresh
   * environment. Reusing the name of a destroyed environment brings back its
   * archived apps, which Inngest cannot unarchive through its API.
   * Changing it triggers a replacement.
   */
  name?: string;
}

export interface BranchEnvironmentAttributes {
  /** Name of the branch environment, for the app's `INNGEST_ENV`. */
  name: string;
}

export type BranchEnvironment = Resource<
  "Inngest.BranchEnvironment",
  BranchEnvironmentProps,
  BranchEnvironmentAttributes,
  never,
  Providers
>;

/**
 * An Inngest branch environment, for pull request and preview deploys.
 *
 * Inngest creates a branch environment the first time an app syncs with
 * `INNGEST_ENV` set to its name, and all branch environments share the
 * signing and event keys of the `branch` parent. This resource owns the name
 * and archives the environment on destroy, rather than waiting for Inngest's
 * three-day inactivity archive. Archiving the environment also archives its
 * apps. Pass the name to `Inngest.App` as `environment` so each deploy
 * unarchives the environment, since syncing alone does not.
 *
 * Credentials must reach branch environments, so configure the Inngest
 * provider with the branch environment signing key.
 * @see https://www.inngest.com/docs/platform/environments
 *
 * ### Preview deploys
 * **Example:** Branch environment per pull request stage
 * ```typescript
 * const env = yield* Inngest.BranchEnvironment("preview");
 *
 * const worker = yield* Cloudflare.Worker("api", {
 *   main: "./src/worker.ts",
 *   env: {
 *     INNGEST_ENV: env.name,
 *     INNGEST_SIGNING_KEY: Config.redacted("INNGEST_BRANCH_SIGNING_KEY"),
 *     INNGEST_EVENT_KEY: Config.redacted("INNGEST_BRANCH_EVENT_KEY"),
 *   },
 * });
 *
 * yield* Inngest.App("app", {
 *   main: "./src/inngest.ts",
 *   url: Output.interpolate`${worker.url}/api/inngest`,
 *   version: worker.hash,
 *   environment: env.name,
 * });
 * ```
 *
 * @resource
 * @product Environments
 */
export const BranchEnvironment = Resource<BranchEnvironment>("Inngest.BranchEnvironment");

export const BranchEnvironmentProvider = () =>
  Provider.effect(
    BranchEnvironment,
    Effect.gen(function* () {
      const api = yield* makeBranchEnvironmentApi;

      const resolveName = (id: string, props: BranchEnvironmentProps | undefined) =>
        props?.name ? Effect.succeed(props.name) : createPhysicalName({ id });

      return {
        stables: ["name"],
        diff: Effect.fn(function* ({ id, news, output }) {
          if (!isResolved(news) || output === undefined) return undefined;
          if ((yield* resolveName(id, news)) !== output.name) {
            return { action: "replace" } as const;
          }
          return undefined;
        }),
        reconcile: Effect.fn(function* ({ id, news }) {
          const name = yield* resolveName(id, news);
          yield* api.setArchived(name, false);
          return { name };
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* api.setArchived(output.name, true);
        }),
        read: Effect.fn(function* ({ id, olds, output }) {
          const name = output?.name ?? (yield* resolveName(id, olds));
          return (yield* api.observe(name)) === undefined ? undefined : { name };
        }),
      };
    }),
  );
