import { Command } from "effect/cli";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { resolveProfileName } from "../../Auth/Resolve.ts";
import { exportStorageState, login } from "../../Linear/Browser.ts";
import * as CliKit from "../CliKit/index.ts";
import { envFile, profile } from "./flags.ts";
import { instrumentCommand } from "./instrument.ts";

const browserLoginCommand = Command.make(
  "browser-login",
  { envFile, profile },
  instrumentCommand("provider.linear.browser-login", (a: { profile: string | undefined }) => ({
    "alchemy.profile": a.profile ?? "",
  }))(
    Effect.fn(function* ({ envFile, profile }) {
      const cli = yield* CliKit.CliKit;
      const name = yield* resolveProfileName(envFile, profile);
      const result = yield* login({ profile: `${name}-linear` });
      yield* cli.output.success({
        message: "Signed in to Linear.",
        detail: `Browser profile: ${result.profileDir}`,
      });
    }),
  ),
).pipe(
  Command.withDescription(
    "Sign in to Linear in a browser so deploys can drive its settings UI unattended",
  ),
);

const browserExportCommand = Command.make(
  "browser-export",
  { envFile, profile },
  instrumentCommand("provider.linear.browser-export", (a: { profile: string | undefined }) => ({
    "alchemy.profile": a.profile ?? "",
  }))(
    Effect.fn(function* ({ envFile, profile }) {
      const name = yield* resolveProfileName(envFile, profile);
      const state = yield* exportStorageState({ profile: `${name}-linear` });
      yield* Console.log(JSON.stringify(state));
    }),
  ),
).pipe(
  Command.withDescription(
    "Print the signed-in Linear browser session as storage state JSON for LINEAR_BROWSER_STORAGE_STATE; when it expires, run browser-login and browser-export again",
  ),
);

export const linearCommand = Command.make("linear", {}).pipe(
  Command.withDescription("Manage Linear provider prerequisites"),
  Command.withSubcommands([browserLoginCommand, browserExportCommand]),
);
