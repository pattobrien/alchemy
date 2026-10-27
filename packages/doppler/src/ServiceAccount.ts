import {
  serviceAccountsCreate,
  serviceAccountsDelete,
  serviceAccountsGet,
  serviceAccountsList,
  serviceAccountsUpdate,
} from "@distilled.cloud/doppler";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import { findInPages, ignoreNotFound, orUndefined } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export type WorkplaceRole = "owner" | "admin" | "collaborator";

export interface ServiceAccountProps {
  /**
   * Service account name, unique in the workplace. Changing it replaces the
   * service account.
   */
  name: string;

  /**
   * Workplace role. Project access comes from `ProjectMember`.
   */
  workplaceRole: WorkplaceRole;
}

export interface ServiceAccountAttributes {
  /**
   * Service account slug, the identifier other Doppler resources take.
   */
  slug: string;

  /**
   * Service account name.
   */
  name: string;
}

export interface ServiceAccount extends Resource<
  "Doppler.ServiceAccount",
  ServiceAccountProps,
  ServiceAccountAttributes,
  never,
  Providers
> {}

/**
 * A Doppler service account: a non-human workplace member that logs in with
 * a `ServiceAccountToken` or an OIDC `ServiceAccountIdentity`.
 *
 * A service account that already exists with the same name is never taken
 * over silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Creating a Service Account
 * **Example:** CI Service Account with Project Access
 * ```typescript
 * const ci = yield* Doppler.ServiceAccount("ci", {
 *   name: "sa-ci",
 *   workplaceRole: "collaborator",
 * });
 *
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
export const ServiceAccount = Resource<ServiceAccount>("Doppler.ServiceAccount");

const byName = (name: string) =>
  findInPages(
    (page) => serviceAccountsList(page).pipe(Effect.map((response) => response.service_accounts)),
    (account) => account.name === name,
  );

const find = (name: string, slug: string | undefined) =>
  (slug === undefined
    ? Effect.succeed(undefined)
    : orUndefined(serviceAccountsGet({ slug })).pipe(
        Effect.map((response) => response?.service_account),
      )
  ).pipe(Effect.flatMap((account) => (account ? Effect.succeed(account) : byName(name))));

export const ServiceAccountProvider = () =>
  Provider.succeed(ServiceAccount, {
    stables: ["slug", "name"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && news.name !== olds.name ? { action: "replace" as const } : undefined,
      ),

    read: ({ olds, output }) =>
      find(olds.name, output?.slug).pipe(
        Effect.map((account) => account && Unowned({ slug: account.slug!, name: account.name! })),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      const live = yield* find(news.name, output?.slug);
      if (live === undefined) {
        const { service_account } = yield* serviceAccountsCreate({
          name: news.name,
          workplace_role: { identifier: news.workplaceRole },
        });
        return { slug: service_account!.slug!, name: news.name };
      }
      if (live.workplace_role?.identifier !== news.workplaceRole) {
        yield* serviceAccountsUpdate({
          slug: live.slug!,
          workplace_role: { identifier: news.workplaceRole },
        });
      }
      return { slug: live.slug!, name: news.name };
    }),

    delete: ({ output }) => ignoreNotFound(serviceAccountsDelete({ slug: output.slug })),
  });
