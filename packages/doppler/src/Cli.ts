import { envFile, profile } from "alchemy/Cli/commands/flags";
import { instrumentCommand } from "alchemy/Cli/commands/instrument";
import * as Interaction from "alchemy/Interaction";
import * as Command from "effect/cli/Command";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Doppler from "./Alchemist.ts";

const browserLoginCommand = Command.make(
  "browser-login",
  { envFile, profile },
  instrumentCommand("provider.doppler.browser-login", (a: { profile: string | undefined }) => ({
    "alchemy.profile": a.profile ?? "",
  }))(
    Effect.fn(function* ({ envFile, profile }) {
      const cli = yield* Interaction.Interaction;
      const result = yield* Doppler.browserLogin({
        profile,
        envFile: Option.getOrUndefined(envFile),
      });
      yield* cli.output.success({
        message: "Signed in to Doppler.",
        detail: `Browser profile: ${result.profileDir}`,
      });
      yield* cli.output.info(
        "Use Doppler.providers({ browser: true }) to let deploys use the dashboard unattended.",
      );
    }),
  ),
).pipe(
  Command.withDescription(
    "Sign in to Doppler in a browser so deploys can use its dashboard unattended",
  ),
);

const browserExportCommand = Command.make(
  "browser-export",
  { envFile, profile },
  instrumentCommand("provider.doppler.browser-export", (a: { profile: string | undefined }) => ({
    "alchemy.profile": a.profile ?? "",
  }))(
    Effect.fn(function* ({ envFile, profile }) {
      const state = yield* Doppler.browserExport({
        profile,
        envFile: Option.getOrUndefined(envFile),
      });
      yield* Console.log(JSON.stringify(state));
    }),
  ),
).pipe(
  Command.withDescription(
    "Print the signed-in Doppler browser session as storage state JSON for DOPPLER_BROWSER_STORAGE_STATE; when it expires, run browser-login and browser-export again",
  ),
);

export const dopplerCommand = Command.make("doppler", {}).pipe(
  Command.withDescription("Manage Doppler provider prerequisites"),
  Command.withSubcommands([browserLoginCommand, browserExportCommand]),
);
