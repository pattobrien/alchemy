import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Argument, Command, Flag } from "effect/cli";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { publishablePackages, sharedVersion, type WorkspacePackage } from "../package-manifest.ts";

const DISTILLED_SCOPE = "@distilled.cloud/";
const REGISTRY = "https://npm.pkg.github.com";
const REPOSITORY = "https://github.com/pattobrien/alchemy.git";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export class InvalidForkVersion extends Data.TaggedError("InvalidForkVersion")<{
  readonly message: string;
  readonly version: string;
}> {}

export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly message: string;
  readonly command: string;
  readonly exitCode: number;
}> {}

const decodeForkConfig = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ distilled: Schema.String })),
);

const decodePackResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ filename: Schema.String })),
);

interface Rewrite {
  readonly field: (typeof DEPENDENCY_FIELDS)[number];
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

interface Plan {
  readonly pkg: WorkspacePackage;
  readonly spec: string;
  readonly rewrites: ReadonlyArray<Rewrite>;
  readonly manifest: Readonly<Record<string, unknown>>;
}

const forkName = (name: string) =>
  name === "alchemy"
    ? "@pattobrien/alchemy"
    : `@pattobrien/alchemy-${name.replace(/^@alchemy\.run\//, "")}`;

const planPackage = (
  pkg: WorkspacePackage,
  target: (name: string) => string | undefined,
  version: string,
): Plan => {
  const fields = DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = pkg.raw[field];
    if (!Predicate.isObject(dependencies)) return [];
    const rewrites = Object.entries(dependencies).flatMap(([name, from]) => {
      const to = target(name);
      return to === undefined ? [] : [{ field, name, from: String(from), to }];
    });
    const rewritten = {
      ...dependencies,
      ...Object.fromEntries(rewrites.map(({ name, to }) => [name, to])),
    };
    return [{ field, rewrites, rewritten }];
  });
  const name = forkName(pkg.manifest.name);
  const publishConfig = pkg.raw.publishConfig;
  return {
    pkg,
    spec: `${name}@${version}`,
    rewrites: fields.flatMap(({ rewrites }) => rewrites),
    manifest: {
      ...pkg.raw,
      name,
      version,
      ...Object.fromEntries(fields.map(({ field, rewritten }) => [field, rewritten])),
      repository: { type: "git", url: REPOSITORY, directory: pkg.dir },
      publishConfig: {
        ...(Predicate.isObject(publishConfig) ? publishConfig : {}),
        registry: REGISTRY,
      },
    },
  };
};

const run = Effect.fn(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: ChildProcess.CommandOptions,
) {
  const spawner = yield* ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(ChildProcess.make(command, [...args], options));
      const [stdout, exitCode] = yield* Effect.all(
        [
          options.stdout === "pipe"
            ? handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
            : Effect.succeed(""),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { exitCode: Number(exitCode), stdout: stdout.trim() };
    }),
  );
});

const runOrFail = Effect.fn(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: ChildProcess.CommandOptions,
) {
  const result = yield* run(command, args, options);
  if (result.exitCode !== 0) {
    const line = [command, ...args].join(" ");
    return yield* new CommandFailed({
      message: `${line} exited with code ${result.exitCode}`,
      command: line,
      exitCode: result.exitCode,
    });
  }
  return result.stdout;
});

const pack = Effect.fn(function* (root: string, destination: string, plan: Plan) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = path.join(root, plan.pkg.dir);
  const manifestPath = path.join(cwd, "package.json");
  const { filename } = yield* Effect.acquireUseRelease(
    fs.readFileString(manifestPath),
    () =>
      fs.writeFileString(manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`).pipe(
        Effect.andThen(
          runOrFail("pnpm", ["pack", "--json", "--pack-destination", destination], {
            cwd,
            stdout: "pipe",
            stderr: "inherit",
          }),
        ),
        Effect.flatMap(decodePackResult),
      ),
    (original) => fs.writeFileString(manifestPath, original).pipe(Effect.orDie),
  );
  return { spec: plan.spec, tarball: path.resolve(destination, filename) };
});

const publish = Effect.fn(function* ({ spec, tarball }: { spec: string; tarball: string }) {
  const existing = yield* run("npm", ["view", spec, "version", "--registry", REGISTRY], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (existing.exitCode === 0 && existing.stdout !== "") {
    return yield* Console.log(`${spec} skipped, already published`);
  }
  yield* runOrFail(
    "pnpm",
    ["publish", tarball, "--registry", REGISTRY, "--tag", "latest", "--no-git-checks"],
    { stdout: "inherit", stderr: "inherit" },
  );
  yield* Console.log(`${spec} published`);
});

const describePlan = ({ pkg, spec, rewrites }: Plan) =>
  [
    `${pkg.manifest.name} -> ${spec} (${pkg.dir})`,
    ...rewrites.map(({ field, name, from, to }) => `  ${field} ${name}: ${from} -> ${to}`),
  ].join("\n");

const command = Command.make(
  "fork-publish",
  {
    version: Argument.String("version").pipe(
      Argument.withDescription("Fork version to publish, <upstream version>-fork.N"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Rewrite and pack every package, print the plan, publish nothing"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* ({ version, dryRun }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const destination = path.join(root, "release-packages");

    const packages = yield* publishablePackages(root, "packages");
    const upstream = yield* sharedVersion(packages);
    if (/^(.+)-fork\.\d+$/.exec(version)?.[1] !== upstream) {
      return yield* new InvalidForkVersion({
        message: `${version} is not ${upstream}-fork.N`,
        version,
      });
    }
    const { distilled } = yield* decodeForkConfig(
      yield* fs.readFileString(path.join(import.meta.dirname, "fork.json")),
    );

    const publishable = new Set(packages.map(({ manifest }) => manifest.name));
    const target = (name: string) =>
      publishable.has(name)
        ? `npm:${forkName(name)}@${version}`
        : name.startsWith(DISTILLED_SCOPE)
          ? `npm:@pattobrien/distilled-${name.slice(DISTILLED_SCOPE.length)}@${distilled}`
          : undefined;
    const plans = packages.map((pkg) => planPackage(pkg, target, version));

    yield* fs.remove(destination, { recursive: true, force: true });
    yield* fs.makeDirectory(destination, { recursive: true });
    const packed = yield* Effect.forEach(plans, (plan) => pack(root, destination, plan));

    if (dryRun) {
      yield* Effect.forEach(plans, (plan) => Console.log(describePlan(plan)));
      return yield* Console.log(`${plans.length} packages planned, nothing published`);
    }
    yield* Effect.forEach(packed, publish);
  }),
).pipe(Command.withDescription("Publish every package to GitHub Packages under the fork scope"));

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
