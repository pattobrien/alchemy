import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { publishablePackages, sharedVersion } from "../package-manifest.ts";
import { runOrFail } from "./command.ts";

const FORK_TAG = /^refs\/tags\/v.+-fork\.(\d+)$/;

const program = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../..");
  const upstream = yield* sharedVersion(yield* publishablePackages(root, "packages"));
  const refs = yield* runOrFail(
    "git",
    ["ls-remote", "--tags", "--refs", "origin", "refs/tags/v*-fork.*"],
    { cwd: root, stdout: "pipe", stderr: "inherit" },
  );
  const numbers = refs.split("\n").flatMap((line) => {
    const n = FORK_TAG.exec(line.split("\t")[1] ?? "")?.[1];
    return n === undefined ? [] : [Number(n)];
  });
  yield* Console.log(`${upstream}-fork.${Math.max(0, ...numbers) + 1}`);
});

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
