import * as AppAuth from "@distilled.cloud/github/App";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import { USER_AGENT } from "./Credentials.ts";

export const asGitHubApp =
  (
    app: { readonly appId: number; readonly privateKey: Redacted.Redacted<string> },
    apiBaseUrl: string,
  ) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provide(
      effect,
      AppAuth.appCredentials({
        appId: app.appId,
        privateKey: app.privateKey,
        apiBaseUrl,
        userAgent: USER_AGENT,
      }),
    );

export async function encryptValue(plaintext: string, publicKey: string): Promise<string> {
  const mod = await import("libsodium-wrappers");
  // Bun/ESM interop: the actual sodium API lives on `.default` when the
  // CJS module is wrapped, but is the module itself under other loaders.
  const sodium: typeof import("libsodium-wrappers") = (mod as any).default ?? mod;
  await sodium.ready;
  const binKey = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const binMessage = sodium.from_string(plaintext);
  const encrypted = sodium.crypto_box_seal(binMessage, binKey);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}
