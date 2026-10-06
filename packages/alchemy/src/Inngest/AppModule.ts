import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import type * as InngestSdk from "inngest";
import type { FunctionConfig } from "inngest/types";

export class AppMainInvalid extends Data.TaggedError("Inngest.AppMainInvalid")<{
  main: string;
  message: string;
  cause?: unknown;
}> {}

export interface AppFunction {
  slug: string;
  config: FunctionConfig;
}

export interface AppModule {
  appId: string;
  functions: AppFunction[];
}

const SERVE_URL = "https://alchemy.invalid/api/inngest";

const importModules = (main: string, href: string) =>
  Effect.tryPromise({
    try: () => Promise.all([import("inngest"), import(href) as Promise<Record<string, unknown>>]),
    catch: (cause) =>
      new AppMainInvalid({ main, message: `Could not import Inngest app module '${main}'`, cause }),
  });

export const loadAppModule = Effect.fn(function* (main: string) {
  const path = yield* Path.Path;
  const href = main.startsWith("file:")
    ? main
    : (yield* path.toFileUrl(path.resolve(main)).pipe(Effect.orDie)).href;
  const [sdk, mod] = yield* importModules(main, href);

  const values = Object.values(mod);
  const found = values.find((value) => sdk.isInngest(value));
  if (found === undefined) {
    return yield* new AppMainInvalid({
      main,
      message: `'${main}' must export an Inngest client created with \`new Inngest({ id })\``,
    });
  }
  const client = found;
  const exported = mod.functions;
  const functions: InngestSdk.InngestFunction.Any[] =
    Array.isArray(exported) && exported.every((fn) => sdk.isInngestFunction(fn))
      ? exported
      : values.filter((value) => sdk.isInngestFunction(value));

  class RegisterBody extends sdk.InngestCommHandler {
    constructor() {
      super({
        frameworkName: "alchemy",
        client,
        functions,
        handler: () => {
          throw new Error("Inngest.App only reads the register body");
        },
      });
    }

    read() {
      return this.registerBody({ url: new URL(SERVE_URL), deployId: undefined });
    }
  }

  const prefix = `${client.id}-`;
  return {
    appId: client.id,
    functions: new RegisterBody().read().functions.map((config) => ({
      slug: config.id.startsWith(prefix) ? config.id.slice(prefix.length) : config.id,
      config,
    })),
  } satisfies AppModule;
});
