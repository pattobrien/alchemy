import * as Inngest from "@distilled.cloud/inngest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

export const makeBranchEnvironmentApi = Effect.gen(function* () {
  const listEnvs = yield* Inngest.fetchV2AccountEnvs;
  const patchEnv = yield* Inngest.patchV2Env;

  const verifyCredentials = listEnvs({ limit: 1 }).pipe(Effect.as(undefined));

  const observe = Effect.fn(function* (name: string) {
    return yield* listEnvs.items({ xInngestEnv: name }).pipe(
      Stream.filter((env) => env.name === name),
      Stream.runHead,
      Effect.map(Option.getOrUndefined),
      Effect.catchTag("EnvironmentUnauthorized", () => verifyCredentials),
    );
  });

  const setArchived = Effect.fn(function* (name: string, isArchived: boolean) {
    const observed = yield* observe(name);
    if (observed?.id === undefined || (observed.isArchived ?? false) === isArchived) {
      return observed;
    }
    return yield* patchEnv({ id: observed.id, xInngestEnv: name, isArchived }).pipe(
      Effect.map((patched) => patched.data),
      Effect.catchTag("EnvironmentNotFound", () => Effect.succeed(undefined)),
    );
  });

  return { observe, setArchived };
});
