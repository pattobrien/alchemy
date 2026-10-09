import { expect } from "alchemy-test";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import { allNoop, guard, hookUrl, oauthApp, oauthAppIds } from "./workspace.ts";

const hasAppCreds =
  !!process.env.LINEAR_TEST_OAUTH_CLIENT_ID && !!process.env.LINEAR_TEST_OAUTH_CLIENT_SECRET;

const { test } = Test.make({
  providers: Linear.providers({
    credentials: Linear.fromClientCredentials({
      clientId: Config.String("LINEAR_TEST_OAUTH_CLIENT_ID"),
      clientSecret: Config.Redacted("LINEAR_TEST_OAUTH_CLIENT_SECRET"),
      scopes: ["read"],
    }),
    browser: true,
  }),
});

test.provider.skipIf(!hasAppCreds)(
  "create, update subscriptions, destroy",
  (stack) =>
    Effect.gen(function* () {
      yield* guard;
      yield* stack.destroy();

      const app = (webhookResourceTypes: Linear.OAuthAppProps["webhookResourceTypes"]) =>
        Effect.gen(function* () {
          const app = yield* Linear.OAuthApp("App", {
            name: "a2-spike-oauth-app",
            developer: "alchemy",
            redirectUris: [hookUrl("oauth/callback")],
            clientCredentials: true,
            webhookUrl: hookUrl("oauth/webhook"),
            webhookResourceTypes,
          });
          return {
            applicationId: app.applicationId,
            clientId: app.clientId,
            clientSecret: app.clientSecret,
            webhookSecret: app.webhookSecret,
          };
        });

      const v1 = yield* stack.deploy(app(["AgentSessionEvent"]));
      expect(yield* oauthApp(v1.applicationId)).toEqual({
        name: "a2-spike-oauth-app",
        developer: "alchemy",
        developerUrl: "",
        description: "",
        clientId: Redacted.value(v1.clientId),
        redirectUris: [hookUrl("oauth/callback")],
        clientCredentials: true,
        webhookUrl: hookUrl("oauth/webhook"),
        webhookResourceTypes: ["AgentSessionEvent"],
      });
      expect(Redacted.value(yield* Effect.fromNullishOr(v1.webhookSecret))).toMatch(/^lin_wh_/);
      const secret = yield* Effect.fromNullishOr(v1.clientSecret);
      yield* Linear.clientCredentialsToken({
        clientId: Redacted.value(v1.clientId),
        clientSecret: secret,
        scopes: ["read"],
      });
      expect(allNoop(yield* stack.plan(app(["AgentSessionEvent"])))).toBe(true);

      const v2 = yield* stack.deploy(app(["AgentSessionEvent", "Issue", "Comment"]));
      expect(v2.applicationId).toBe(v1.applicationId);
      expect(v2.clientSecret && Redacted.value(v2.clientSecret)).toBe(Redacted.value(secret));
      const live = yield* oauthApp(v2.applicationId);
      expect(live.webhookResourceTypes.toSorted()).toEqual([
        "AgentSessionEvent",
        "Comment",
        "Issue",
      ]);

      yield* stack.destroy();
      expect(yield* oauthAppIds).not.toContain(v2.applicationId);
    }),
  { timeout: 300_000 },
);
