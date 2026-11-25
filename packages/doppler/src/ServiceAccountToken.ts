import {
  serviceAccountTokensCreate,
  serviceAccountTokensDelete,
  serviceAccountTokensGet,
} from "@distilled.cloud/doppler";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { ignoreNotFound, orUndefined } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface ServiceAccountTokenProps {
  /**
   * Slug of the service account the token authenticates as.
   */
  serviceAccount: string;

  /**
   * Token name.
   */
  name: string;

  /**
   * ISO-8601 expiry. Unset never expires.
   */
  expiresAt?: string;
}

export interface ServiceAccountTokenAttributes {
  /**
   * Token slug.
   */
  slug: string;

  /**
   * The API key. Doppler only returns it when the token is created.
   */
  apiKey: Redacted.Redacted<string>;
}

export interface ServiceAccountToken extends Resource<
  "Doppler.ServiceAccountToken",
  ServiceAccountTokenProps,
  ServiceAccountTokenAttributes,
  never,
  Providers
> {}

/**
 * An API token for a Doppler service account.
 *
 * Doppler shows the key once, so changing any prop replaces the token, and a
 * token deleted outside the stack is minted again on the next deploy.
 *
 * ### Minting a Token
 * **Example:** Token for an Agent
 * ```typescript
 * const agent = yield* Doppler.ServiceAccount("agent", {
 *   name: "sa-agent",
 *   workplaceRole: "collaborator",
 * });
 *
 * const token = yield* Doppler.ServiceAccountToken("agent-token", {
 *   serviceAccount: agent.slug,
 *   name: "agent",
 * });
 * ```
 *
 * @resource
 * @product Doppler
 */
export const ServiceAccountToken = Resource<ServiceAccountToken>("Doppler.ServiceAccountToken");

const exists = (serviceAccount: string, slug: string | undefined) =>
  slug === undefined
    ? Effect.succeed(false)
    : orUndefined(
        serviceAccountTokensGet({ service_account: serviceAccount, api_token: slug }),
      ).pipe(Effect.map((response) => response?.api_token !== undefined));

export const ServiceAccountTokenProvider = () =>
  Provider.succeed(ServiceAccountToken, {
    stables: ["slug", "apiKey"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) &&
          (news.serviceAccount !== olds.serviceAccount ||
            news.name !== olds.name ||
            news.expiresAt !== olds.expiresAt)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds, output }) =>
      exists(olds.serviceAccount, output?.slug).pipe(
        Effect.map((found) => (found ? output : undefined)),
      ),

    reconcile: Effect.fn(function* ({ news, output }) {
      if (output && (yield* exists(news.serviceAccount, output.slug))) return output;
      const created = yield* serviceAccountTokensCreate({
        service_account: news.serviceAccount,
        name: news.name,
        expires_at: news.expiresAt,
      });
      const apiKey = created.api_key!;
      return {
        slug: created.api_token!.slug!,
        apiKey: Redacted.isRedacted(apiKey) ? apiKey : Redacted.make(apiKey),
      };
    }),

    delete: ({ olds, output }) =>
      ignoreNotFound(
        serviceAccountTokensDelete({
          service_account: olds.serviceAccount,
          api_token: output.slug,
        }),
      ),
  });
