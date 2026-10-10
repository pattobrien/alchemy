import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Linear from "@/Linear";
import { listOAuthApps } from "@/Linear/WebFlows.ts";

const cli = fileURLToPath(new URL("../../bin/cli.js", import.meta.url));

const browserExport = Effect.sync(() =>
  spawnSync("bun", [cli, "provider", "linear", "browser-export", "--profile", "default"], {
    encoding: "utf8",
    timeout: 60_000,
  }),
).pipe(
  Effect.tap((result) => Effect.sync(() => expect(result.status).toBe(0))),
  Effect.map((result) => result.stdout),
);

describe(
  "Linear browser storage state",
  { tags: ["browser", "local"], optInTags: ["browser"] },
  () => {
    layer(NodeServices.layer, { excludeTestServices: true })((it) => {
      it.effect(
        "an empty profile restored from an exported session lists the OAuth applications",
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const root = yield* fs.makeTempDirectoryScoped({ prefix: "alchemy-linear-state-" });
            const file = path.join(root, "state.json");
            yield* fs.writeFileString(file, yield* browserExport, { mode: 0o600 });

            const apps = yield* listOAuthApps("finedesigns-test").pipe(
              Effect.provide(
                Linear.Browser.layer({
                  profileDir: path.join(root, "profile"),
                  storageState: file,
                }),
              ),
            );
            expect(apps.map((app) => app.name)).toContain("alchemy");
          }),
        { timeout: 180_000 },
      );
    });
  },
);
