import { AuthError } from "alchemy/Auth/AuthProvider";
import { getEnv, getEnvRedacted } from "alchemy/Auth/Env";
import {
  makeStoredAuthProvider,
  storedSecret,
  storedValueText,
  type StoredAuthConfig,
} from "alchemy/Auth/StoredAuthProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const NAMESPACELABS_AUTH_PROVIDER_NAME = "NamespaceLabs";
export const NSC_TOKEN_ENV = "NSC_TOKEN";
export const NSC_REGION_ENV = "NSC_REGION";

export type NamespaceLabsAuthConfig = StoredAuthConfig;

export type NamespaceLabsResolvedCredentials = {
  readonly token: Redacted.Redacted<string>;
  readonly region: string | undefined;
  readonly source: { type: NamespaceLabsAuthConfig["method"] | "env"; details?: string };
};

const nonEmpty = (value: Redacted.Redacted<string> | undefined) =>
  value !== undefined && Redacted.value(value).length > 0 ? value : undefined;

const namespaceLabsAuth = makeStoredAuthProvider<NamespaceLabsResolvedCredentials>({
  provider: NAMESPACELABS_AUTH_PROVIDER_NAME,
  fields: [
    { name: "token", label: "Namespace tenant token", secret: true },
    { name: "region", label: "Namespace region (default us)", optional: true },
  ],
  toResolved: (values) => ({
    token: storedSecret(values.token) ?? Redacted.make(""),
    region: storedValueText(values.region) || undefined,
    source: { type: "stored" },
  }),
  readEnvironment: Effect.all({
    token: getEnvRedacted(NSC_TOKEN_ENV),
    region: getEnv(NSC_REGION_ENV),
  }).pipe(
    Effect.flatMap(({ token, region }) => {
      const present = nonEmpty(token);
      return present === undefined
        ? AuthError.make({
            message: `Namespace credentials are missing. Set ${NSC_TOKEN_ENV} to a tenant token from \`nsc auth generate-dev-token\` or \`nsc token create\`.`,
          })
        : Effect.succeed({
            token: present,
            region: region || undefined,
            source: { type: "env" as const, details: NSC_TOKEN_ENV },
          });
    }),
  ),
  environment: [
    {
      name: NSC_TOKEN_ENV,
      required: true,
      secret: true,
      description: "A Namespace tenant token; mint one with `nsc auth generate-dev-token`",
    },
    { name: NSC_REGION_ENV, required: false, secret: false },
  ],
});

/**
 * Layer that registers the Namespace {@link AuthProvider} into the
 * {@link AuthProviders} registry.
 *
 * Auth is a tenant token (`NSC_TOKEN`) and an optional region (`NSC_REGION`)
 * that selects the compute and storage hosts.
 */
export const NamespaceLabsAuth = namespaceLabsAuth.layer;
