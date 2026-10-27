import {
  DopplerAuth,
  type DopplerAuthConfig,
  type DopplerResolvedCredentials,
} from "@alchemy.run/doppler/AuthProvider";
import { describe, expect, it } from "@alchemy.run/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthProviders, getAuthProvider } from "alchemy/Auth/AuthProvider";
import { ProfileStore } from "alchemy/Auth/Profile";
import * as Interaction from "alchemy/Interaction";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { makeFakeProfileStore } from "../Prisma/fakes.ts";

const githubActions = {
  GITHUB_ACTIONS: "true",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-bearer",
  DOPPLER_IDENTITY_ID: "identity-1",
};

const fakeGitHubAndDoppler = (dopplerStatuses: ReadonlyArray<number>) => {
  const presented: string[] = [];
  let issued = 0;
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      if (request.url.startsWith(githubActions.ACTIONS_ID_TOKEN_REQUEST_URL)) {
        issued += 1;
        return HttpClientResponse.fromWeb(request, Response.json({ value: `jwt-${issued}` }));
      }
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      presented.push(JSON.parse(body).token);
      const status = dopplerStatuses[presented.length - 1] ?? 200;
      return HttpClientResponse.fromWeb(
        request,
        status === 200
          ? Response.json({ token: "dp.sa.minted", expires_at: "2099-01-01T00:00:00Z" })
          : Response.json(
              { success: false, messages: ["Request took longer than 29 seconds"] },
              { status },
            ),
      );
    }),
  );
  return { client, presented };
};

const testLayer = (client: HttpClient.HttpClient) =>
  DopplerAuth.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(AuthProviders, {}),
        Layer.succeed(ProfileStore, makeFakeProfileStore()),
        Layer.succeed(HttpClient.HttpClient, client),
        ConfigProvider.layer(ConfigProvider.fromUnknown(githubActions)),
        Interaction.layerNonInteractive(),
      ),
    ),
  );

const readEnvironmentCredentials = Effect.gen(function* () {
  const auth = yield* getAuthProvider<DopplerAuthConfig, DopplerResolvedCredentials>("Doppler");
  if (auth.readEnvironment === undefined) {
    return yield* Effect.die("Doppler does not expose CI environment credentials");
  }
  return yield* auth.readEnvironment;
});

describe("Doppler auth provider", { tags: ["unit", "provider:doppler", "local"] }, () => {
  it.live("logs in again with a fresh platform token after Doppler fails a login", () => {
    const { client, presented } = fakeGitHubAndDoppler([503]);
    return Effect.gen(function* () {
      const credentials = yield* readEnvironmentCredentials;
      expect(Redacted.value(credentials.token)).toBe("dp.sa.minted");
      expect(presented).toEqual(["jwt-1", "jwt-2"]);
    }).pipe(Effect.provide(testLayer(client)));
  });
});
