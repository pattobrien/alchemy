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
   * The whole policy file as HuJSON. Comments are kept as written.
   */
  body: string;
}

export interface PolicyAttributes {
  /**
   * Tailnet the policy file belongs to.
   */
  tailnet: string;

  /**
   * Entity tag of the stored policy file.
   */
  eTag?: string;

  /**
   * The stored policy file.
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

/**
 * Tailscale refused the policy file during planning: it does not parse, or
 * one of its `tests` fails against its own rules.
 */
export class PolicyRejected extends Data.TaggedError("Tailscale.PolicyRejected")<{
  readonly message: string;
  readonly data: ReadonlyArray<unknown>;
}> {}

/**
 * A tailnet's policy file.
 *
 * Every tailnet always has one, so there is nothing to create: the first
 * deploy takes over the current file and writes `body` over it. A changed
 * `body` is validated and its tests run while planning, so a broken policy
 * fails the plan instead of the deploy. Each write is guarded by the ETag of
 * the file it read, so an edit made in the admin console between plan and
 * deploy fails with `PreconditionFailed` instead of being overwritten.
 *
 * Destroying the resource leaves the live policy file as it is.
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

const validate = (tailnet: string, body: string) =>
  validateAndTestPolicyFile({ tailnet, body }).pipe(
    Effect.flatMap((result) =>
      result.message === undefined || result.message === ""
        ? Effect.void
        : Effect.fail(new PolicyRejected({ message: result.message, data: result.data ?? [] })),
    ),
  );

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

    reconcile: Effect.fn(function* ({ news }) {
      const tailnet = news.tailnet ?? DEFAULT_TAILNET;
      const live = yield* getPolicyFile({ tailnet });
      if (live.body === news.body) return attributes(tailnet, live);
      const stored = yield* setPolicyFile({ tailnet, body: news.body, ifMatch: live.eTag });
      return attributes(tailnet, stored);
    }),

    delete: () => Effect.void,
  });
