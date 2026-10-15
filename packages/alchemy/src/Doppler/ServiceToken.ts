import {
  serviceTokensCreate,
  serviceTokensDelete,
  serviceTokensList,
} from "@distilled.cloud/doppler";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { ignoreNotFound, orUndefined } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface ServiceTokenProps {
  /**
   * Slug of the project the token reads from.
   */
  project: string;

  /**
   * Name of the config the token is scoped to.
   */
  config: string;

  /**
   * Token name.
   */
  name: string;

  /**
   * Whether the token can only read secrets or also write them.
   */
  access: "read" | "read/write";
}

export interface ServiceTokenAttributes {
  /**
   * Token slug.
   */
  slug: string;

  /**
   * The token. Doppler only returns it when the token is created.
   */
  key: Redacted.Redacted<string>;
}

export interface ServiceToken extends Resource<
  "Doppler.ServiceToken",
  ServiceTokenProps,
  ServiceTokenAttributes,
  never,
  Providers
> {}

/**
 * A Doppler service token: a key scoped to a single config.
 *
 * Doppler shows the key once, so changing any prop replaces the token, and a
 * token deleted outside the stack is minted again on the next deploy.
 *
 * ### Minting a Service Token
 * **Example:** Read-Only Token for Production
 * ```typescript
 * const token = yield* Doppler.ServiceToken("api-prd", {
 *   project: "api",
 *   config: "prd",
 *   name: "api-prd",
 *   access: "read",
 * });
 * ```
 *
 * @resource
 * @product Doppler
 */
export const ServiceToken = Resource<ServiceToken>("Doppler.ServiceToken");

const exists = (props: ServiceTokenProps, slug: string | undefined) =>
  slug === undefined
    ? Effect.succeed(false)
    : orUndefined(serviceTokensList({ project: props.project, config: props.config })).pipe(
        Effect.map((response) => response?.tokens?.some((token) => token.slug === slug) ?? false),
      );

export const ServiceTokenProvider = () =>
  Provider.succeed(ServiceToken, {
    stables: ["slug", "key"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) &&
          (news.project !== olds.project ||
            news.config !== olds.config ||
            news.name !== olds.name ||
            news.access !== olds.access)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds, output }) =>
      exists(olds, output?.slug).pipe(Effect.map((found) => (found ? output : undefined))),

    reconcile: Effect.fn(function* ({ news, output }) {
      if (output && (yield* exists(news, output.slug))) return output;
      const { token } = yield* serviceTokensCreate({
        project: news.project,
        config: news.config,
        name: news.name,
        access: news.access,
      });
      const key = token!.key!;
      return {
        slug: token!.slug!,
        key: Redacted.isRedacted(key) ? key : Redacted.make(key),
      };
    }),

    delete: ({ olds, output }) =>
      exists(olds, output.slug).pipe(
        Effect.flatMap((found) =>
          found
            ? ignoreNotFound(
                serviceTokensDelete({
                  project: olds.project,
                  config: olds.config,
                  slug: output.slug,
                }),
              )
            : Effect.void,
        ),
      ),
  });
