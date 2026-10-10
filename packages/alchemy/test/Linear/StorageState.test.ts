import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Linear from "@/Linear";
import { listOAuthApps } from "@/Linear/WebFlows.ts";

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
            const state = yield* Linear.Browser.exportStorageState({ profile: "default-linear" });
            yield* fs.writeFileString(file, JSON.stringify(state), { mode: 0o600 });

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
