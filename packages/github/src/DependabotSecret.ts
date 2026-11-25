import * as Dependabot from "@distilled.cloud/github/dependabot";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { withBaseUrl, gitHubBaseUrlChanged } from "./BaseUrl.ts";
import { encryptValue } from "./internal.ts";
import type * as GitHub from "./Providers.ts";

export interface DependabotSecretProps {
  /**
   * Repository owner (user or organization).
   */
  owner: string;

  /**
   * Repository name.
   */
  repository: string;

  /**
   * Secret name (e.g. `NPM_TOKEN`).
   */
  name: string;

  /**
   * Secret value. Wrap with `Redacted.make` to prevent the value from
   * appearing in logs or state.
   */
  value: Redacted.Redacted;

  /**
   * Override the GitHub host or API base URL for this resource only (e.g.
   * `github.example.com` for GitHub Enterprise). Falls back to
   * `GitHub.providers({ baseUrl })`, then to the host resolved by the auth
   * provider. Changing it replaces the resource.
   */
  baseUrl?: string;
}

export interface DependabotSecret extends Resource<
  "GitHub.DependabotSecret",
  DependabotSecretProps,
  {
    /**
     * ISO-8601 timestamp of the last update, as GitHub reports it.
     */
    updatedAt: string;
  },
  never,
  GitHub.Providers
> {}

/**
 * A Dependabot repository secret.
 *
 * Workflow runs that Dependabot triggers read secrets from the Dependabot
 * store instead of the Actions store, so a secret those runs need must be
 * declared here as well as in `GitHub.Secret`. The value is sealed with the
 * repository's Dependabot public key before upload.
 *
 * **Example:** Create a Dependabot Secret
 * ```typescript
 * yield* GitHub.DependabotSecret("npm-token", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "NPM_TOKEN",
 *   value: Redacted.make(npmToken),
 * });
 * ```
 *
 * @resource
 * @product Dependabot
 */
export const DependabotSecret = Resource<DependabotSecret>("GitHub.DependabotSecret");

export const DependabotSecretProvider = () =>
  Provider.succeed(DependabotSecret, {
    diff: Effect.fn(function* ({ news, olds }) {
      if (!isResolved(news)) return;
      if (olds === undefined) return;
      if (
        news.owner !== olds.owner ||
        news.repository !== olds.repository ||
        news.name !== olds.name ||
        (yield* gitHubBaseUrlChanged(olds, news))
      ) {
        return { action: "replace" };
      }
    }),

    read: Effect.fn(function* ({ olds }) {
      return yield* readSecret(olds);
    }),

    reconcile: Effect.fn(function* ({ news }) {
      yield* upsertSecret(news);
      const observed = yield* readSecret(news);
      if (observed === undefined) {
        return yield* new DependabotSecretMissing({ secretName: news.name });
      }
      return observed;
    }),

    delete: Effect.fn(function* ({ olds }) {
      yield* deleteSecret(olds);
    }),
  });

export class DependabotSecretMissing extends Data.TaggedError("DependabotSecretMissing")<{
  readonly secretName: string;
}> {
  override get message(): string {
    return `Dependabot secret ${this.secretName} is missing right after it was written`;
  }
}

const readSecret = Effect.fn(
  function* (props: DependabotSecretProps) {
    const secret = yield* Dependabot.getRepoSecret({
      owner: props.owner,
      repo: props.repository,
      secret_name: props.name,
    }).pipe(Effect.catchTag("NotFound", () => Effect.undefined));
    return secret === undefined ? undefined : { updatedAt: secret.updated_at };
  },
  (effect, props) => effect.pipe(withBaseUrl(props.baseUrl)),
);

const upsertSecret = Effect.fn(
  function* (props: DependabotSecretProps) {
    const scope = { owner: props.owner, repo: props.repository };
    const publicKey = yield* Dependabot.getRepoPublicKey(scope);
    const encrypted = yield* Effect.tryPromise(() =>
      encryptValue(Redacted.value(props.value), publicKey.key),
    );
    yield* Dependabot.createOrUpdateRepoSecret({
      ...scope,
      secret_name: props.name,
      encrypted_value: encrypted,
      key_id: publicKey.key_id,
    });
  },
  (effect, props) => effect.pipe(withBaseUrl(props.baseUrl)),
);

const deleteSecret = Effect.fn(
  function* (props: DependabotSecretProps) {
    yield* Dependabot.deleteRepoSecret({
      owner: props.owner,
      repo: props.repository,
      secret_name: props.name,
    }).pipe(Effect.catchTag("NotFound", () => Effect.void));
  },
  (effect, props) => effect.pipe(withBaseUrl(props.baseUrl)),
);
