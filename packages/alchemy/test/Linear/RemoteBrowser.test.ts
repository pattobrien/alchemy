import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "alchemy-test";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { chromium } from "playwright-core";
import * as Linear from "@/Linear";
import { listOAuthApps } from "@/Linear/WebFlows.ts";

const GARDEN_BROWSER = "https://browser.finedesigns.io";

describe(
  "Linear browser connected to a remote browser over CDP",
  { tags: ["browser", "local"], optInTags: ["browser"] },
  () => {
    layer(NodeServices.layer, { excludeTestServices: true })((it) => {
      it.effect(
        "lists the OAuth applications from the signed-in default context and leaves the browser running",
        () =>
          Effect.gen(function* () {
            const connect = {
              cdpUrl: GARDEN_BROWSER,
              headers: {
                "CF-Access-Client-Id": yield* Config.String("BROWSER_ACCESS_CLIENT_ID"),
                "CF-Access-Client-Secret": yield* Config.Redacted("BROWSER_ACCESS_CLIENT_SECRET"),
              },
            };
            const names = listOAuthApps("finedesigns-test").pipe(
              Effect.provide(Linear.Browser.layer({ connect })),
              Effect.map((apps) => apps.map((app) => app.name)),
            );
            expect(yield* names).toContain("alchemy");
            expect(yield* names).toContain("alchemy");
          }),
        { timeout: 180_000 },
      );

      it.effect(
        "fails with LinearBrowserSignedOut naming the remote browser when its context is signed out",
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const profileDir = yield* fs.makeTempDirectoryScoped({ prefix: "alchemy-linear-cdp-" });
            yield* Effect.acquireRelease(
              Effect.promise(() =>
                chromium.launchPersistentContext(profileDir, {
                  channel: "chrome",
                  headless: true,
                  args: ["--remote-debugging-port=0"],
                }),
              ),
              (context) => Effect.promise(() => context.close()),
            );
            const [port] = (yield* fs.readFileString(
              path.join(profileDir, "DevToolsActivePort"),
            )).split("\n");
            const cdpUrl = `http://127.0.0.1:${port}`;

            const result = yield* listOAuthApps("finedesigns-test").pipe(
              Effect.provide(Linear.Browser.layer({ connect: { cdpUrl } })),
              Effect.result,
            );

            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result)) {
              expect(result.failure._tag).toBe("LinearBrowserSignedOut");
              expect(result.failure.message).toBe(
                `Linear is not signed in on https://linear.app/finedesigns-test/settings/api (remote browser: ${cdpUrl}). Sign in its default context.`,
              );
            }
          }),
        { timeout: 120_000 },
      );
    });
  },
);
