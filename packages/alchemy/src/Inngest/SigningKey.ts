import * as Inngest from "@distilled.cloud/inngest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";

export interface SigningKeyProps {
  /**
   * Environment to read the key from. Defaults to the environment the
   * configured API key belongs to: `production` for a production key,
   * `branch` for the branch environment signing key.
   */
  environment?: string;
}

export interface SigningKeyAttributes {
  /** Signing key id. */
  id: string;
  /** Environment the key signs for. */
  environment: string;
  /** The signing key, for the host's `INNGEST_SIGNING_KEY`. */
  key: Redacted.Redacted<string>;
}

export type SigningKey = Resource<
  "Inngest.SigningKey",
  SigningKeyProps,
  SigningKeyAttributes,
  never,
  Providers
>;

export class SigningKeyNotFound extends Data.TaggedError("Inngest.SigningKeyNotFound")<{
  environment: string | undefined;
}> {
  override get message() {
    return `Inngest has no signing key in ${this.environment === undefined ? "the configured key's environment" : `environment '${this.environment}'`}`;
  }
}

/**
 * A read-only handle to an Inngest signing key, so a host can bind
 * `INNGEST_SIGNING_KEY` from the stack instead of a copied secret.
 *
 * Inngest issues one active signing key per environment and all branch
 * environments share the `branch` parent's key. Deployment reads the key
 * through the configured API key and records it in state; it does not
 * create or rotate keys, and destroying the resource leaves the key in place.
 * @see https://www.inngest.com/docs/platform/signing-keys
 *
 * ### Serving functions from a Worker
 * **Example:** Bind the branch signing key into a Worker
 * ```typescript
 * const env = yield* Inngest.BranchEnvironment("preview");
 * const signingKey = yield* Inngest.SigningKey("signing");
 *
 * const worker = yield* Cloudflare.Worker("api", {
 *   main: "./src/worker.ts",
 *   env: {
 *     INNGEST_ENV: env.name,
 *     INNGEST_SIGNING_KEY: signingKey.key,
 *   },
 * });
 * ```
 *
 * @resource
 * @product Keys
 */
export const SigningKey = Resource<SigningKey>("Inngest.SigningKey");

export const SigningKeyProvider = () =>
  Provider.effect(
    SigningKey,
    Effect.gen(function* () {
      const listKeys = yield* Inngest.fetchV2AccountSigningKeys;

      const observe = Effect.fn(function* (environment: string | undefined) {
        const found = yield* listKeys
          .items({ xInngestEnv: environment })
          .pipe(Stream.runHead, Effect.map(Option.getOrUndefined));
        if (found?.key === undefined) {
          return yield* new SigningKeyNotFound({ environment });
        }
        return {
          id: found.id!,
          environment: found.environment!,
          key: Redacted.make(found.key),
        };
      });

      return {
        nuke: { skip: true },
        reconcile: Effect.fn(function* ({ news }) {
          return yield* observe(news.environment);
        }),
        read: Effect.fn(function* ({ olds, output }) {
          return yield* observe(output?.environment ?? olds.environment).pipe(
            Effect.catchTag("Inngest.SigningKeyNotFound", () => Effect.succeed(undefined)),
          );
        }),
        delete: () => Effect.void,
      };
    }),
  );
