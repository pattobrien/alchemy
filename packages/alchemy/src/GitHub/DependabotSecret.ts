import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { gitHubBaseUrlChanged, octokitFor, unlessStatus } from "./Octokit.ts";
import type * as GitHub from "./Providers.ts";
import { encryptValue } from "./Secret.ts";

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
        return yield* Effect.fail(
          new Error(`Dependabot secret ${news.name} is missing right after it was written`),
        );
      }
      return observed;
    }),

    delete: Effect.fn(function* ({ olds }) {
      const octokit = yield* octokitFor(olds.baseUrl);
      yield* unlessStatus([404], () =>
        octokit.rest.dependabot.deleteRepoSecret({
          owner: olds.owner,
          repo: olds.repository,
          secret_name: olds.name,
        }),
      );
    }),
  });

const readSecret = Effect.fn(function* (props: DependabotSecretProps) {
  const octokit = yield* octokitFor(props.baseUrl);
  const response = yield* unlessStatus([404], () =>
    octokit.rest.dependabot.getRepoSecret({
      owner: props.owner,
      repo: props.repository,
      secret_name: props.name,
    }),
  );
  return response === undefined ? undefined : { updatedAt: response.data.updated_at };
});

const upsertSecret = Effect.fn(function* (props: DependabotSecretProps) {
  const octokit = yield* octokitFor(props.baseUrl);
  const { data: publicKey } = yield* Effect.tryPromise(() =>
    octokit.rest.dependabot.getRepoPublicKey({ owner: props.owner, repo: props.repository }),
  );
  const encrypted = yield* Effect.tryPromise(() =>
    encryptValue(Redacted.value(props.value), publicKey.key),
  );
  yield* Effect.tryPromise(() =>
    octokit.rest.dependabot.createOrUpdateRepoSecret({
      owner: props.owner,
      repo: props.repository,
      secret_name: props.name,
      encrypted_value: encrypted,
      key_id: publicKey.key_id,
    }),
  );
});
