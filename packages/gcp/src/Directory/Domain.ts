import * as directory from "@distilled.cloud/gcp/unstable/admin_directory_v1";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "../Providers.ts";
import { normalizeCustomer } from "./internal.ts";

export type DomainProps = {
  /**
   * Fully qualified domain name (`example.com`). Changing it replaces
   * the domain.
   */
  domainName: string;
  /**
   * Workspace customer id (`C0123abc`) or `my_customer` for the
   * caller's account. Changing it replaces the domain.
   * @default "my_customer"
   */
  customer?: string;
};

export type Domain = Resource<
  "GCP.Directory.Domain",
  DomainProps,
  {
    /** Fully qualified domain name. */
    domainName: string;
    /** Workspace customer id or `my_customer`. */
    customer: string;
    /** Whether Google has verified ownership of the domain. */
    verified: boolean;
    /** Whether this is the customer's primary domain. */
    isPrimary: boolean;
    /** Names of the domain aliases attached to this domain. */
    domainAliases: string[];
    /** RFC3339 creation timestamp. */
    creationTime: string | undefined;
  },
  never,
  Providers
>;

/**
 * A domain of a Google Workspace account, managed through the Admin SDK
 * Directory API.
 *
 * The credential must act as a Workspace administrator: a service
 * account with domain-wide delegation for the
 * `admin.directory.domain` scope and a delegation subject (see the GCP
 * auth provider's `scopes` and `subject` settings). Adding a domain does
 * not verify it; publish the verification record in DNS. The primary
 * domain cannot be removed through the API, so destroying it leaves the
 * domain in place. An existing domain is reported as unowned until
 * adopted.
 *
 * ### Adding a Domain
 * **Example:** Secondary domain
 * ```typescript
 * const domain = yield* GCP.Directory.Domain("Marketing", {
 *   domainName: "example.org",
 * });
 * ```
 *
 * ### Adopting the Primary Domain
 * **Example:** Track the primary domain without risking its removal
 * ```typescript
 * const primary = yield* GCP.Directory.Domain("Primary", {
 *   domainName: "example.com",
 * }).pipe(adopt(true));
 * ```
 *
 * @resource
 * @category Directory
 */
export const Domain = Resource<Domain>("GCP.Directory.Domain");

export class DomainNotResolved extends Data.TaggedError("GCP.Directory.DomainNotResolved")<{
  domainName: string;
}> {}

const toAttrs = (domain: directory.Domains, customer: string) => ({
  domainName: domain.domainName ?? "",
  customer,
  verified: domain.verified ?? false,
  isPrimary: domain.isPrimary ?? false,
  domainAliases: (domain.domainAliases ?? []).flatMap((alias) =>
    alias.domainAliasName !== undefined ? [alias.domainAliasName] : [],
  ),
  creationTime: domain.creationTime,
});

const getDomain = (customer: string, domainName: string | undefined) =>
  domainName === undefined || domainName.length === 0
    ? Effect.succeed(undefined)
    : directory
        .getDomains({ customer, domainName })
        .pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined)));

export const DomainProvider = () =>
  Provider.succeed(Domain, {
    stables: ["domainName", "customer", "creationTime"],

    diff: Effect.fn(function* ({ news, olds }) {
      if (!isResolved(news)) return undefined;
      if (
        olds.domainName.toLowerCase() !== news.domainName.toLowerCase() ||
        normalizeCustomer(olds.customer) !== normalizeCustomer(news.customer)
      ) {
        return { action: "replace" as const, deleteFirst: false };
      }
      return { action: "noop" as const };
    }),

    read: Effect.fn(function* ({ olds, output }) {
      const customer = output?.customer ?? normalizeCustomer(olds?.customer);
      const existing = yield* getDomain(customer, output?.domainName ?? olds?.domainName);
      if (existing === undefined) return undefined;
      const attrs = toAttrs(existing, customer);
      return output !== undefined ? attrs : Unowned(attrs);
    }),

    reconcile: Effect.fn(function* ({ news }) {
      const customer = normalizeCustomer(news.customer);
      let current = yield* getDomain(customer, news.domainName);

      if (current === undefined) {
        current = yield* directory
          .insertDomains({ customer, body: { domainName: news.domainName } })
          .pipe(
            Effect.catchTag("Conflict", () =>
              Effect.succeed<directory.Domains | undefined>(undefined),
            ),
          );
        if (current === undefined) {
          current = yield* getDomain(customer, news.domainName);
        }
      }

      if (current === undefined) {
        return yield* new DomainNotResolved({ domainName: news.domainName });
      }

      return toAttrs(current, customer);
    }),

    delete: Effect.fn(function* ({ output }) {
      if (output.isPrimary) {
        yield* Effect.logDebug(
          `GCP.Directory.Domain: ${output.domainName} is the primary domain and cannot be deleted; leaving it in place`,
        );
        return;
      }
      if (output.domainName.length === 0) return;
      yield* directory
        .deleteDomains({ customer: output.customer, domainName: output.domainName })
        .pipe(Effect.catchTag("NotFound", () => Effect.void));
    }),
  });
