import * as dns from "@distilled.cloud/vercel/dns";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";

export type DnsRecordType = Exclude<dns.CreateRecordRequestType, "MX" | "SRV" | "HTTPS">;

export interface DnsRecordProps {
  /**
   * Domain whose Vercel DNS zone holds the record, e.g. `example.com`. The
   * domain must use Vercel nameservers. Changing it triggers a replacement.
   */
  domain: string;
  /**
   * Team that owns the domain, e.g. `team.teamId`. Defaults to the access
   * token's default scope. Changing it triggers a replacement.
   */
  teamId?: string;
  /**
   * Subdomain label, e.g. `www`, or an empty string for the apex. Changing it
   * triggers a replacement.
   */
  name: string;
  /**
   * Record type. Changing it triggers a replacement.
   */
  type: DnsRecordType;
  /**
   * Record value, e.g. an IP address for `A` or a hostname for `CNAME`.
   */
  value: string;
  /**
   * Time to live in seconds, between 60 and 2147483647.
   * @default 60
   */
  ttl?: number;
  /**
   * Note describing what the record is for.
   */
  comment?: string;
}

export interface DnsRecordAttributes {
  /** Vercel DNS record ID, e.g. `rec_abc123`. */
  recordId: string;
  /** Domain whose zone holds the record. */
  domain: string;
  /** Team the record was requested under, if any. */
  teamId: string | undefined;
  /** Subdomain label, or an empty string for the apex. */
  name: string;
  /** Record type. */
  type: DnsRecordType;
  /** Record value. */
  value: string;
  /** Time to live in seconds. */
  ttl: number;
  /** Note describing the record, or `null`. */
  comment: string | null;
}

export interface DnsRecord extends Resource<
  "Vercel.DnsRecord",
  DnsRecordProps,
  DnsRecordAttributes,
  never,
  Providers
> {}

/**
 * A DNS record in a domain that uses Vercel DNS.
 *
 * Vercel DNS records carry no tags, so a record with the same name, type and
 * value that exists before the first deploy is reported as unowned and
 * requires `Alchemy.adopt(true)`.
 *
 * ### Creating records
 * **Example:** Point a subdomain at an IP address
 * ```typescript
 * const record = yield* Vercel.DnsRecord("Api", {
 *   domain: "example.com",
 *   name: "api",
 *   type: "A",
 *   value: "203.0.113.10",
 * });
 * ```
 *
 * **Example:** Domain verification TXT record
 * ```typescript
 * yield* Vercel.DnsRecord("Verification", {
 *   domain: "example.com",
 *   name: "_verify",
 *   type: "TXT",
 *   value: "token-from-the-provider",
 *   ttl: 300,
 *   comment: "Search console verification",
 * });
 * ```
 *
 * ### Using a team domain
 * **Example:** CNAME on a team-owned domain
 * ```typescript
 * const team = yield* Vercel.Team("Team", { slug: "my-team" }).pipe(Alchemy.adopt(true));
 * yield* Vercel.DnsRecord("Docs", {
 *   domain: "example.com",
 *   teamId: team.teamId,
 *   name: "docs",
 *   type: "CNAME",
 *   value: "cname.vercel-dns.com",
 * });
 * ```
 *
 * @resource
 * @product DNS
 */
export const DnsRecord = Resource<DnsRecord>("Vercel.DnsRecord");

export class DnsRecordNotCreated extends Data.TaggedError("DnsRecordNotCreated")<{
  message: string;
}> {}

export class DnsRecordTypeUnsupported extends Data.TaggedError("DnsRecordTypeUnsupported")<{
  message: string;
}> {}

const toType = Effect.fn(function* (type: dns.GetDomainsRecordResponseRecordType) {
  switch (type) {
    case "MX":
    case "SRV":
    case "HTTPS":
      return yield* new DnsRecordTypeUnsupported({
        message: `Vercel.DnsRecord does not manage ${type} records`,
      });
    default:
      return type;
  }
});

const getRecord = Effect.fn(function* (
  recordId: string,
  domain: string,
  teamId: string | undefined,
) {
  const record = yield* dns.getDomainsRecord({ recordId, teamId });
  return {
    recordId: record.id,
    domain,
    teamId,
    name: record.name,
    type: yield* toType(record.recordType),
    value: record.value,
    ttl: record.ttl ?? 60,
    comment: record.comment || null,
  } satisfies DnsRecordAttributes;
});

const observeRecord = (recordId: string, domain: string, teamId: string | undefined) =>
  getRecord(recordId, domain, teamId).pipe(
    Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
  );

const findRecord = Effect.fn(function* (props: DnsRecordProps) {
  const listed = yield* dns
    .getRecords({ domain: props.domain, teamId: props.teamId, limit: "100" })
    .pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined)));
  if (listed === undefined || typeof listed === "string") return undefined;
  const match = listed.records.find(
    (record) =>
      record.name === props.name && record.type === props.type && record.value === props.value,
  );
  return match && (yield* getRecord(match.id, props.domain, props.teamId));
});

export const DnsRecordProvider = () =>
  Provider.succeed(DnsRecord, {
    stables: ["recordId", "domain", "name", "type"],
    diff: Effect.fn(function* ({ olds, news }) {
      if (!isResolved(news)) return;
      if (
        news.domain !== olds.domain ||
        news.teamId !== olds.teamId ||
        news.name !== olds.name ||
        news.type !== olds.type
      ) {
        return { action: "replace" } as const;
      }
    }),
    read: Effect.fn(function* ({ olds, output }) {
      if (output) return yield* observeRecord(output.recordId, output.domain, output.teamId);
      const attrs = yield* findRecord(olds);
      return attrs && Unowned(attrs);
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      let observed = output
        ? yield* observeRecord(output.recordId, news.domain, news.teamId)
        : undefined;
      if (!observed) {
        const created = yield* dns.createRecord({
          domain: news.domain,
          teamId: news.teamId,
          type: news.type,
          name: news.name,
          value: news.value,
          ttl: news.ttl,
          comment: news.comment,
        });
        if (!created.uid) {
          return yield* new DnsRecordNotCreated({
            message: `Vercel did not return an ID for DNS record "${news.name}" on ${news.domain}`,
          });
        }
        observed = yield* getRecord(created.uid, news.domain, news.teamId);
      }
      const ttl = news.ttl ?? 60;
      const comment = news.comment ?? null;
      if (observed.value !== news.value || observed.ttl !== ttl || observed.comment !== comment) {
        yield* dns.updateRecord({
          recordId: observed.recordId,
          teamId: news.teamId,
          value: news.value,
          ttl,
          comment: comment ?? "",
        });
        observed = yield* getRecord(observed.recordId, news.domain, news.teamId);
      }
      return observed;
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* dns
        .removeRecord({ domain: output.domain, recordId: output.recordId, teamId: output.teamId })
        .pipe(Effect.catchTag("NotFound", () => Effect.void));
    }),
  });
