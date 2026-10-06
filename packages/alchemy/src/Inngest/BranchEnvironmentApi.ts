import * as Inngest from "@distilled.cloud/inngest";
import * as Effect from "effect/Effect";

export const makeBranchEnvironmentApi = Effect.gen(function* () {
  const listEnvs = yield* Inngest.fetchV2AccountEnvs;
  const patchEnv = yield* Inngest.patchV2Env;

  const observe = Effect.fn(function* (name: string) {
    const observed = yield* listEnvs({ xInngestEnv: name }).pipe(
      Effect.map((res) => res.data?.find((env) => env.name === name)),
      Effect.catchTag("Unauthorized", () => Effect.succeed(undefined)),
    );
    if (observed !== undefined) return observed;
    yield* listEnvs({});
    return undefined;
  });

  const setArchived = Effect.fn(function* (name: string, isArchived: boolean) {
    const observed = yield* observe(name);
    if (observed?.id === undefined || (observed.isArchived ?? false) === isArchived) {
      return observed;
    }
    const patched = yield* patchEnv({ id: observed.id, xInngestEnv: name, isArchived }).pipe(
      Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
    );
    return patched?.data;
  });

  return { observe, setArchived };
});
