import { getSecret, secretsUpdateNote, updateSecret } from "@distilled.cloud/doppler";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import { ignoreNotFound, orUndefined, reveal } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface SecretProps {
  /**
   * Slug of the project the secret belongs to.
   */
  project: string;

  /**
   * Name of the config the secret belongs to.
   */
  config: string;

  /**
   * Secret name, such as `API_KEY`.
   */
  name: string;

  /**
   * Raw secret value. A reference such as `${infra.prd.API_KEY}` is a plain
   * string that Doppler resolves when the secret is read.
   */
  value: string | Redacted.Redacted<string>;

  /**
   * Note shown next to the secret. Doppler keeps one note per secret name
   * across the project's configs. Unset leaves the current note alone.
   */
  note?: string;
}

export interface SecretAttributes {
  /**
   * Slug of the project the secret belongs to.
   */
  project: string;

  /**
   * Name of the config the secret belongs to.
   */
  config: string;

  /**
   * Secret name.
   */
  name: string;
}

export interface Secret extends Resource<
  "Doppler.Secret",
  SecretProps,
  SecretAttributes,
  never,
  Providers
> {}

/**
 * A secret in a Doppler config.
 *
 * Drift is detected on the raw value, so a reference stays a reference. A
 * secret that already holds the declared value is adopted as is; one that
 * holds a different value is overwritten on deploy. Destroying the secret
 * removes it from the config.
 *
 * ### Writing Secrets
 * **Example:** Literal Value
 * ```typescript
 * import * as Redacted from "effect/Redacted";
 *
 * yield* Doppler.Secret("api-key", {
 *   project: "api",
 *   config: "prd",
 *   name: "API_KEY",
 *   value: Redacted.make(apiKey),
 * });
 * ```
 *
 * **Example:** Reference to Another Secret
 * ```typescript
 * import * as Output from "alchemy/Output";
 *
 * const prd = yield* Doppler.Secret("api-key-prd", {
 *   project: "api",
 *   config: "prd",
 *   name: "API_KEY",
 *   value: Redacted.make(apiKey),
 * });
 *
 * // Doppler rejects a reference to a secret that does not exist yet, so
 * // build it from the referenced secret's attributes to deploy it second.
 * yield* Doppler.Secret("api-key-stg", {
 *   project: "api",
 *   config: "stg",
 *   name: "API_KEY",
 *   value: Output.interpolate`\${${prd.project}.${prd.config}.${prd.name}}`,
 *   note: "points at prd until a stg key is minted",
 * });
 * ```
 *
 * @resource
 * @product Doppler
 */
export const Secret = Resource<Secret>("Doppler.Secret");

const raw = ({ project, config, name }: SecretProps) =>
  orUndefined(getSecret({ project, config, name })).pipe(Effect.map((secret) => secret?.value));

const attributes = ({ project, config, name }: SecretProps): SecretAttributes => ({
  project,
  config,
  name,
});

export const SecretProvider = () =>
  Provider.succeed(Secret, {
    stables: ["project", "config", "name"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) &&
          (news.project !== olds.project || news.config !== olds.config || news.name !== olds.name)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds }) =>
      raw(olds).pipe(
        Effect.map((live) =>
          reveal(live?.raw) === reveal(olds.value) ? attributes(olds) : undefined,
        ),
      ),

    reconcile: Effect.fn(function* ({ news }) {
      const live = yield* raw(news);
      if (reveal(live?.raw) !== reveal(news.value)) {
        yield* updateSecret({
          project: news.project,
          config: news.config,
          secrets: { [news.name]: reveal(news.value) },
        });
      }
      if (news.note !== undefined && news.note !== (live?.note ?? "")) {
        yield* secretsUpdateNote({ project: news.project, secret: news.name, note: news.note });
      }
      return attributes(news);
    }),

    delete: ({ output }) =>
      ignoreNotFound(
        updateSecret({
          project: output.project,
          config: output.config,
          secrets: { [output.name]: null },
        }),
      ),
  });
