import {
  deleteV3workplaceserviceAccountsserviceAccountServiceAccountIdentitiesidentityIdentity as deleteIdentity,
  getV3workplaceserviceAccountsserviceAccountServiceAccountIdentities as listIdentities,
  getV3workplaceserviceAccountsserviceAccountServiceAccountIdentitiesidentityIdentity as getIdentity,
  postV3workplaceserviceAccountsserviceAccountServiceAccountIdentities as createIdentity,
  putV3workplaceserviceAccountsserviceAccountServiceAccountIdentitiesidentityIdentity as updateIdentity,
} from "@distilled.cloud/doppler";
import { Unowned } from "alchemy/AdoptPolicy";
import { deepEqual, isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import { ignoreNotFound, orUndefined } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface ServiceAccountIdentityProps {
  /**
   * Slug of the service account the identity logs in as. Changing it
   * replaces the identity.
   */
  serviceAccount: string;

  /**
   * Identity name, unique on the service account. Changing it replaces the
   * identity.
   */
  name: string;

  /**
   * OIDC discovery URL of the token issuer, such as
   * `https://token.actions.githubusercontent.com`.
   */
  discoveryUrl: string;

  /**
   * Whether `claims` values match exactly or as `*` wildcards.
   */
  claimsType: "exact" | "wildcard";

  /**
   * Claim name to the values it may take. `aud` and `sub` are required.
   */
  claims: Record<string, string[]>;

  /**
   * Lifetime of the Doppler token minted at login, in seconds.
   */
  ttlSeconds: number;
}

export interface ServiceAccountIdentityAttributes {
  /**
   * Identity slug, the `DOPPLER_IDENTITY_ID` to log in with.
   */
  slug: string;
}

export interface ServiceAccountIdentity extends Resource<
  "Doppler.ServiceAccountIdentity",
  ServiceAccountIdentityProps,
  ServiceAccountIdentityAttributes,
  never,
  Providers
> {}

/**
 * An OIDC identity on a Doppler service account. A platform token whose
 * claims match logs in as the service account without a stored secret.
 *
 * An identity that already exists with the same name is never taken over
 * silently: deploy it with `adopt(true)` to manage it.
 *
 * ### Trusting GitHub Actions
 * **Example:** Main Branch of One Repository
 * ```typescript
 * const ci = yield* Doppler.ServiceAccount("ci", {
 *   name: "sa-ci",
 *   workplaceRole: "collaborator",
 * });
 *
 * const identity = yield* Doppler.ServiceAccountIdentity("github-actions", {
 *   serviceAccount: ci.slug,
 *   name: "github-actions",
 *   discoveryUrl: "https://token.actions.githubusercontent.com",
 *   claimsType: "wildcard",
 *   claims: {
 *     aud: ["https://github.com/my-org"],
 *     sub: ["repo:my-org/my-repo:ref:refs/heads/main"],
 *   },
 *   ttlSeconds: 3600,
 * });
 * ```
 *
 * @resource
 * @product Doppler
 */
export const ServiceAccountIdentity = Resource<ServiceAccountIdentity>(
  "Doppler.ServiceAccountIdentity",
);

const find = Effect.fn("findIdentity")(function* (
  props: ServiceAccountIdentityProps,
  slug: string | undefined,
) {
  const bySlug =
    slug === undefined
      ? undefined
      : (yield* orUndefined(getIdentity({ service_account: props.serviceAccount, identity: slug })))
          ?.identity;
  if (bySlug) return bySlug;
  const listed = yield* orUndefined(listIdentities({ service_account: props.serviceAccount }));
  return listed?.identities?.find((identity) => identity.name === props.name);
});

const request = (props: ServiceAccountIdentityProps) => ({
  service_account: props.serviceAccount,
  name: props.name,
  method: "oidc",
  config: {
    discovery_url: props.discoveryUrl,
    claims_type: props.claimsType,
    claims: props.claims,
  },
  ttl_seconds: props.ttlSeconds,
});

export const ServiceAccountIdentityProvider = () =>
  Provider.succeed(ServiceAccountIdentity, {
    stables: ["slug"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && (news.serviceAccount !== olds.serviceAccount || news.name !== olds.name)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds, output }) =>
      find(olds, output?.slug).pipe(
        Effect.map((identity) => identity && Unowned({ slug: identity.slug! })),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      const live = yield* find(news, output?.slug);
      if (live === undefined) {
        const { identity } = yield* createIdentity(request(news));
        return { slug: identity!.slug! };
      }
      const desired = request(news);
      if (!deepEqual(live.config, desired.config) || live.ttl_seconds !== desired.ttl_seconds) {
        yield* updateIdentity({ ...desired, identity: live.slug! });
      }
      return { slug: live.slug! };
    }),

    delete: ({ olds, output }) =>
      ignoreNotFound(
        deleteIdentity({ service_account: olds.serviceAccount, identity: output.slug }),
      ),
  });
