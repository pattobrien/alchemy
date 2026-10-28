import * as NodeCrypto from "node:crypto";
import {
  GCP_AUTH_PROVIDER_NAME,
  GcpAuth,
  GcpAuthConfigSchema,
  parseScopes,
  serviceAccountKeyFromEnv,
  type GcpAuthConfig,
  type GcpResolvedCredentials,
} from "@alchemy.run/gcp/AuthProvider";
import {
  CLOUD_PLATFORM_SCOPE,
  signServiceAccountJwt,
  type ServiceAccountKey,
} from "@alchemy.run/gcp/Token";
import { describe, expect, it } from "@alchemy.run/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthProviders, getAuthProvider } from "alchemy/Auth/AuthProvider";
import { CredentialsStore } from "alchemy/Auth/Credentials";
import { ProfileStore } from "alchemy/Auth/Profile";
import * as Interaction from "alchemy/Interaction";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { makeFakeCredentialsStore, makeFakeProfileStore } from "../Prisma/fakes.ts";

const DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user",
  "https://www.googleapis.com/auth/admin.directory.domain",
];

const keyPair = NodeCrypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const serviceAccount: ServiceAccountKey = {
  type: "service_account",
  project_id: "alchemy-test",
  client_email: "deployer@alchemy-test.iam.gserviceaccount.com",
  private_key: keyPair.privateKey,
};

const ClaimsSchema = Schema.Struct({
  iss: Schema.String,
  sub: Schema.optionalKey(Schema.String),
  scope: Schema.String,
  aud: Schema.String,
  iat: Schema.Number,
  exp: Schema.Number,
});

const decodeClaims = (jwt: string) => {
  const [header, payload, signature] = jwt.split(".");
  const verifier = NodeCrypto.createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  expect(verifier.verify(keyPair.publicKey, signature ?? "", "base64url")).toBe(true);
  return Schema.decodeUnknownSync(Schema.fromJsonString(ClaimsSchema))(
    Buffer.from(payload ?? "", "base64url").toString("utf8"),
  );
};

const envLayer = (env: Record<string, string>) =>
  Layer.mergeAll(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromUnknown(env)));

const authLayer = Layer.provideMerge(
  GcpAuth,
  Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(AuthProviders, {}),
    Layer.succeed(ProfileStore, makeFakeProfileStore()),
    Layer.succeed(CredentialsStore, makeFakeCredentialsStore()),
    ConfigProvider.layer(ConfigProvider.fromUnknown({})),
    Interaction.layerNonInteractive(),
  ),
);

const gcpAuthProvider = getAuthProvider<GcpAuthConfig, GcpResolvedCredentials>(
  GCP_AUTH_PROVIDER_NAME,
);

const writeKeyFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();
  const file = path.join(dir, "key.json");
  yield* fs.writeFileString(file, JSON.stringify(serviceAccount));
  return file;
});

describe("GCP service-account auth", { tags: ["unit", "provider:gcp", "local"] }, () => {
  it.effect("signs a cloud-platform JWT without a subject by default", () =>
    Effect.sync(() => {
      const claims = decodeClaims(signServiceAccountJwt(serviceAccount, 1_700_000_000_000));
      expect(claims.iss).toBe(serviceAccount.client_email);
      expect(claims.scope).toBe(CLOUD_PLATFORM_SCOPE);
      expect("sub" in claims).toBe(false);
      expect(claims.exp - claims.iat).toBe(3600);
    }),
  );

  it.effect("joins scopes with spaces and sets sub to the delegation subject", () =>
    Effect.sync(() => {
      const claims = decodeClaims(
        signServiceAccountJwt(serviceAccount, 1_700_000_000_000, {
          scopes: DIRECTORY_SCOPES,
          subject: "admin@example.com",
        }),
      );
      expect(claims.scope).toBe(DIRECTORY_SCOPES.join(" "));
      expect(claims.sub).toBe("admin@example.com");
    }),
  );

  it.effect("parses scopes separated by whitespace or commas", () =>
    Effect.sync(() => {
      expect(parseScopes(` ${DIRECTORY_SCOPES[0]},${DIRECTORY_SCOPES[1]}\n`)).toEqual(
        DIRECTORY_SCOPES,
      );
      expect(parseScopes(DIRECTORY_SCOPES.join(" "))).toEqual(DIRECTORY_SCOPES);
      expect(parseScopes(" , ")).toBeUndefined();
    }),
  );

  it.effect("reads GOOGLE_CREDENTIALS as key JSON when it starts with {", () =>
    Effect.gen(function* () {
      const key = yield* serviceAccountKeyFromEnv;
      expect(key?.client_email).toBe(serviceAccount.client_email);
    }).pipe(
      Effect.provide(envLayer({ GOOGLE_CREDENTIALS: `  ${JSON.stringify(serviceAccount)}` })),
    ),
  );

  it.effect("reads GOOGLE_CREDENTIALS as a key file path otherwise", () =>
    Effect.gen(function* () {
      const file = yield* writeKeyFile;
      const key = yield* serviceAccountKeyFromEnv.pipe(
        Effect.provide(envLayer({ GOOGLE_CREDENTIALS: file })),
      );
      expect(key?.client_email).toBe(serviceAccount.client_email);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("falls back to the GOOGLE_APPLICATION_CREDENTIALS path", () =>
    Effect.gen(function* () {
      const file = yield* writeKeyFile;
      const key = yield* serviceAccountKeyFromEnv.pipe(
        Effect.provide(envLayer({ GOOGLE_APPLICATION_CREDENTIALS: file })),
      );
      expect(key?.client_email).toBe(serviceAccount.client_email);
      const none = yield* serviceAccountKeyFromEnv.pipe(Effect.provide(envLayer({})));
      expect(none).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects malformed GOOGLE_CREDENTIALS JSON without echoing it", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(serviceAccountKeyFromEnv);
      expect(error._tag).toBe("AuthError");
      expect(error.message).toBe("GOOGLE_CREDENTIALS is not a valid service-account JSON key");
    }).pipe(Effect.provide(envLayer({ GOOGLE_CREDENTIALS: '{"private_key": "secret-material' }))),
  );

  it.effect("stores scopes and subject from profile fields", () =>
    Effect.gen(function* () {
      const auth = yield* gcpAuthProvider;
      if (auth.configureWith === undefined) {
        return yield* Effect.die("GCP does not expose flag-driven configuration");
      }
      const config = yield* auth.configureWith("default", {
        method: "serviceAccount",
        values: {
          scopes: DIRECTORY_SCOPES.join(","),
          subject: " admin@example.com ",
        },
      });
      expect(config).toEqual({
        method: "serviceAccount",
        scopes: DIRECTORY_SCOPES,
        subject: "admin@example.com",
      });
      expect(Schema.decodeUnknownSync(GcpAuthConfigSchema)(config)).toEqual(config);
      const fields = auth.configureMethods?.find(({ method }) => method === "serviceAccount");
      expect(fields?.fields.map(({ name }) => name)).toEqual([
        "credentialsFile",
        "scopes",
        "subject",
        "region",
      ]);
    }).pipe(Effect.provide(authLayer)),
  );
});
