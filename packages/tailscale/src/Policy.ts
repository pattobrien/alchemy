import {
  getPolicyFile,
  setPolicyFile,
  validateAndTestPolicyFile,
} from "@distilled.cloud/tailscale";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Providers } from "./Providers.ts";

export interface PolicyProps {
  /**
   * Tailnet the policy file belongs to. `-` is the credentials' own tailnet.
   * Changing it replaces the resource.
   *
   * @default "-"
   */
  tailnet?: string;

  /**
   * The whole policy file as HuJSON. Tailscale stores it formatted (tabs,
   * aligned values, one trailing newline) and keeps comments as written.
   */
  body: string;

  /**
   * Reset the tailnet to its default policy file when the resource is
   * destroyed. Off by default, so destroy only forgets the resource.
   *
   * @default false
   */
  resetOnDelete?: boolean;
}

export interface PolicyAttributes {
  /**
   * Tailnet the policy file belongs to.
   */
  tailnet: string;

  /**
   * Entity tag of the stored policy file: the SHA-256 of its formatted body.
   */
  eTag?: string;

  /**
   * The policy file as Tailscale stores it.
   */
  body: string;
}

export interface Policy extends Resource<
  "Tailscale.Policy",
  PolicyProps,
  PolicyAttributes,
  never,
  Providers
> {}

export interface PolicyFinding {
  readonly user?: string;
  readonly errors?: ReadonlyArray<string>;
  readonly warnings?: ReadonlyArray<string>;
}

/**
 * Tailscale refused the policy file: it does not parse, or one of its `tests`
 * fails against its own rules. Raised while planning a changed body and, if
 * the file changed underneath the plan, while writing it.
 */
export class PolicyRejected extends Data.TaggedError("Tailscale.PolicyRejected")<{
  readonly message: string;
  readonly findings: ReadonlyArray<PolicyFinding>;
}> {}

/**
 * A tailnet's policy file.
 *
 * Every tailnet always has one, so there is nothing to create: the first
 * deploy takes over the current file and writes `body` over it. A changed
 * `body` is validated and its tests run while planning, so a broken policy
 * fails the plan instead of the deploy; warnings are logged and do not block.
 * Each write is guarded by the ETag of the file it read, so an edit made in
 * the admin console between plan and deploy fails with `PreconditionFailed`
 * instead of being overwritten.
 *
 * Destroying the resource leaves the live policy file as it is unless
 * `resetOnDelete` is set, which restores Tailscale's default policy.
 *
 * ### Applying a Policy
 * **Example:** Policy File from the Repository
 * ```typescript
 * import { readFileSync } from "node:fs";
 *
 * yield* Tailscale.Policy("policy", {
 *   body: readFileSync("tailscale/policy.hujson", "utf8"),
 * });
 * ```
 *
 * @resource
 * @product Tailscale
 */
export const Policy = Resource<Policy>("Tailscale.Policy");

const DEFAULT_TAILNET = "-";

const Findings = Schema.Array(
  Schema.Struct({
    user: Schema.String.pipe(Schema.optionalKey),
    errors: Schema.Array(Schema.String).pipe(Schema.optionalKey),
    warnings: Schema.Array(Schema.String).pipe(Schema.optionalKey),
  }),
);

const validate = Effect.fn(function* (tailnet: string, body: string) {
  const result = yield* validateAndTestPolicyFile({ tailnet, body });
  if (result.message === undefined || result.message === "") return;
  const findings = yield* Schema.decodeUnknownEffect(Findings)(result.data ?? []);
  const failed = findings.length === 0 || findings.some((finding) => finding.errors?.length);
  if (failed) {
    return yield* new PolicyRejected({ message: result.message, findings });
  }
  for (const finding of findings) {
    for (const warning of finding.warnings ?? []) {
      yield* Effect.logWarning(
        `Tailscale policy warning for ${finding.user ?? tailnet}: ${warning}`,
      );
    }
  }
});

const attributes = (
  tailnet: string,
  file: { body: string; eTag?: string | undefined },
): PolicyAttributes => ({ tailnet, eTag: file.eTag, body: file.body });

export const PolicyProvider = () =>
  Provider.succeed(Policy, {
    stables: ["tailnet"],

    nuke: { singleton: true },

    diff: Effect.fn(function* ({ news, olds }) {
      if (!isResolved(news)) return;
      const tailnet = news.tailnet ?? DEFAULT_TAILNET;
      if (tailnet !== (olds.tailnet ?? DEFAULT_TAILNET)) return { action: "replace" as const };
      if (news.body !== olds.body) yield* validate(tailnet, news.body);
    }),

    read: ({ olds }) => {
      const tailnet = olds.tailnet ?? DEFAULT_TAILNET;
      return getPolicyFile({ tailnet }).pipe(Effect.map((file) => attributes(tailnet, file)));
    },

    reconcile: Effect.fn(function* ({ news, olds, output }) {
      const tailnet = news.tailnet ?? DEFAULT_TAILNET;
      const live = yield* getPolicyFile({ tailnet });
      const unchanged =
        olds !== undefined &&
        output !== undefined &&
        olds.body === news.body &&
        output.eTag !== undefined &&
        output.eTag === live.eTag;
      if (unchanged) return attributes(tailnet, live);
      const stored = yield* setPolicyFile({ tailnet, body: news.body, ifMatch: live.eTag }).pipe(
        Effect.catchTag(
          "PolicyFileRejected",
          (error) =>
            new PolicyRejected({ message: error.message, findings: error.body?.data ?? [] }),
        ),
      );
      return attributes(tailnet, stored);
    }),

    delete: Effect.fn(function* ({ olds }) {
      if (!olds.resetOnDelete) return;
      yield* setPolicyFile({ tailnet: olds.tailnet ?? DEFAULT_TAILNET, body: "" });
    }),
  });
