import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";

export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly message: string;
  readonly command: string;
  readonly exitCode: number;
}> {}

export const run = Effect.fn(function* (
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

export const runOrFail = Effect.fn(function* (
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
