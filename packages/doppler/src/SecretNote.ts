import { listConfigs, listSecrets, secretsUpdateNote } from "@distilled.cloud/doppler";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import { ignoreNotFound, orUndefined, PAGE_SIZE } from "./Client.ts";
import type { Providers } from "./Providers.ts";

export interface SecretNoteProps {
  /**
   * Slug of the project the secret belongs to.
   */
  project: string;

  /**
   * Secret name, such as `API_KEY`.
   */
  secret: string;

  /**
   * Note shown next to the secret in every config of the project.
   */
  note: string;
}

export interface SecretNoteAttributes {
  /**
   * Slug of the project the secret belongs to.
   */
  project: string;

  /**
   * Secret name.
   */
  secret: string;

  /**
   * Note shown next to the secret.
   */
  note: string;
}

export interface SecretNote extends Resource<
  "Doppler.SecretNote",
  SecretNoteProps,
  SecretNoteAttributes,
  never,
  Providers
> {}

/**
 * The note on a Doppler secret.
 *
 * Doppler keeps one note per secret name across a project's configs, and
 * only accepts a note for a secret that exists in at least one of them.
 * Deleting the secret from its last config deletes the note with it.
 * Destroying the resource clears the note.
 *
 * ### Annotating Secrets
 * **Example:** Note on a Secret
 * ```typescript
 * const secret = yield* Doppler.Secret("api-key", {
 *   project: "api",
 *   config: "prd",
 *   name: "API_KEY",
 *   value: Redacted.make(apiKey),
 * });
 *
 * yield* Doppler.SecretNote("api-key-note", {
 *   project: secret.project,
 *   secret: secret.name,
 *   note: "rotated by the billing team",
 * });
 * ```
 *
 * @resource
 * @product Doppler
 */
export const SecretNote = Resource<SecretNote>("Doppler.SecretNote");

const find = ({ project, secret }: Pick<SecretNoteProps, "project" | "secret">) =>
  orUndefined(
    Effect.gen(function* () {
      for (let page = 1; ; page++) {
        const { configs = [] } = yield* listConfigs({ project, page, per_page: PAGE_SIZE });
        for (const config of configs) {
          const { secrets = {} } = yield* listSecrets({
            project,
            config: config.name!,
            secrets: secret,
          });
          const live = secrets[secret];
          if (live !== undefined) return { project, secret, note: live.note ?? "" };
        }
        if (configs.length < PAGE_SIZE) return undefined;
      }
    }),
  );

export const SecretNoteProvider = () =>
  Provider.succeed(SecretNote, {
    stables: ["project", "secret"],

    diff: ({ news, olds }) =>
      Effect.succeed(
        isResolved(news) && (news.project !== olds.project || news.secret !== olds.secret)
          ? { action: "replace" as const }
          : undefined,
      ),

    read: ({ olds }) => find(olds),

    reconcile: Effect.fn(function* ({ news }) {
      yield* secretsUpdateNote({ project: news.project, secret: news.secret, note: news.note });
      return { project: news.project, secret: news.secret, note: news.note };
    }),

    delete: ({ output }) =>
      ignoreNotFound(
        secretsUpdateNote({ project: output.project, secret: output.secret, note: "" }),
      ),
  });
