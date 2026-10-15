import { createServer, type Server } from "node:http";
import { expect, it } from "alchemy-test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { AuthError } from "@/Auth/AuthProvider.ts";
import { detectOidcToken } from "@/Auth/OidcToken.ts";

const listening = (status: number) =>
  Effect.acquireRelease(
    Effect.callback<Server>((resume) => {
      const server = createServer((_, response) => {
        response.writeHead(status);
        response.end();
      });
      server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
    }),
    (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void))),
  );

const tokenUrl = (server: Server) => {
  const address = server.address();
  return typeof address === "object" && address !== null
    ? `http://127.0.0.1:${address.port}/token`
    : String(address);
};

it.effect(
  "fails, rather than finding no token, when GitHub Actions' token request fails",
  () =>
    Effect.gen(function* () {
      const server = yield* listening(503);
      const error = yield* detectOidcToken({
        token: "TEST_OIDC_TOKEN",
        audience: "TEST_OIDC_AUDIENCE",
      }).pipe(
        Effect.flip,
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            GITHUB_ACTIONS: "true",
            ACTIONS_ID_TOKEN_REQUEST_URL: tokenUrl(server),
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
          }),
        ),
      );
      expect(error).toBeInstanceOf(AuthError);
      expect(error.message).toContain("503");
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  { tags: ["unit", "local"] },
);
