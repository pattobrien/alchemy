import { expect } from "alchemy-test";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Linear from "@/Linear";
import * as Test from "@/Test/Alchemy";
import { allNoop, guard, hasLinearCreds, hookUrl, oauthApp, oauthAppIds } from "./workspace.ts";

const local = Test.make({ providers: Linear.providers({ browser: true }) });

const garden = Test.make({
  providers: Layer.unwrap(
    Effect.gen(function* () {
      return Linear.providers({
        browser: {
          connect: {
            cdpUrl: "https://browser.finedesigns.io",
            headers: {
              "CF-Access-Client-Id": yield* Config.String("BROWSER_ACCESS_CLIENT_ID"),
              "CF-Access-Client-Secret": yield* Config.Redacted("BROWSER_ACCESS_CLIENT_SECRET"),
            },
          },
        },
      });
    }).pipe(Effect.orDie),
  ),
});

const cycle = (name: string) => (stack: Test.ScratchStack) =>
  Effect.gen(function* () {
    yield* guard;
    yield* stack.destroy();

    const app = (webhookResourceTypes: Linear.OAuthAppProps["webhookResourceTypes"]) =>
      Effect.gen(function* () {
        const app = yield* Linear.OAuthApp("App", {
          name,
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
      name,
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
    expect(live.webhookResourceTypes.toSorted()).toEqual(["AgentSessionEvent", "Comment", "Issue"]);

    yield* stack.destroy();
    expect(yield* oauthAppIds).not.toContain(v2.applicationId);
  });

local.test.provider.skipIf(!hasLinearCreds)(
  "create, update subscriptions, destroy through a local browser",
  cycle("a2-spike-oauth-app"),
  { timeout: 300_000 },
);

garden.test.provider.skipIf(!hasLinearCreds)(
  "create, update subscriptions, destroy through the remote garden browser",
  cycle("a2-spike-oauth-app-remote"),
  { timeout: 300_000, tags: ["browser"], optInTags: ["browser"] },
);
