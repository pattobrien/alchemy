import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as GitHub from "@/GitHub";

const cli = fileURLToPath(new URL("../../bin/cli.js", import.meta.url));

const browserExport = Effect.sync(() =>
  spawnSync("bun", [cli, "provider", "github", "browser-export", "--profile", "pattobrien-test"], {
    encoding: "utf8",
    timeout: 60_000,
  }),
).pipe(
  Effect.tap((result) => Effect.sync(() => expect(result.status).toBe(0))),
  Effect.map((result) => result.stdout),
);

const signedInUser = GitHub.GitHubBrowser.use((browser) =>
  browser.page("https://github.com/settings/profile", (page) =>
    page.locator('meta[name="user-login"]').getAttribute("content"),
  ),
);

describe(
  "GitHub browser storage state",
  { tags: ["browser", "local"], optInTags: ["browser"] },
  () => {
    layer(NodeServices.layer, { excludeTestServices: true })((it) => {
      it.effect(
        "an empty profile restored from an exported session is signed in, and one without it is not",
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const root = yield* fs.makeTempDirectoryScoped({ prefix: "alchemy-github-state-" });
            const file = path.join(root, "state.json");
            yield* fs.writeFileString(file, yield* browserExport, { mode: 0o600 });

            const user = yield* signedInUser.pipe(
              Effect.provide(
                GitHub.Browser.layer({
                  profileDir: path.join(root, "restored"),
                  storageState: file,
                }),
              ),
            );
            expect(user).toBe("pattobrien-test");

            const error = yield* signedInUser.pipe(
              Effect.provide(GitHub.Browser.layer({ profileDir: path.join(root, "empty") })),
              Effect.flip,
            );
            expect(error._tag).toBe("GitHubBrowserSignedOut");
          }),
        { timeout: 180_000 },
      );
    });
  },
);
