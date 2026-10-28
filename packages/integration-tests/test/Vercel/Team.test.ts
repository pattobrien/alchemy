import { expect } from "@alchemy.run/test";
import { providers } from "@alchemy.run/vercel/Providers";
import { Team } from "@alchemy.run/vercel/Team";
import * as teams from "@distilled.cloud/vercel/teams";
import * as user from "@distilled.cloud/vercel/user";
import { adopt, OwnedBySomeoneElse } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Alchemy";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Result from "effect/Result";

const { test } = Test.make({ providers: providers() });

const logLevel = Effect.provideService(MinimumLogLevel, process.env.DEBUG ? "Debug" : "Info");

test.provider(
  "adopts the default team and leaves it in place on destroy",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const { user: me } = yield* user.getAuthUser({});
      const defaultTeamId = me.defaultTeamId!;
      const live = yield* teams.getTeam({ teamId: defaultTeamId });

      const refused = yield* stack
        .deploy(
          Effect.gen(function* () {
            return yield* Team("Team", {});
          }),
        )
        .pipe(Effect.result);
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) expect(refused.failure).toBeInstanceOf(OwnedBySomeoneElse);

      const team = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Team("Team", {}).pipe(adopt(true));
        }),
      );
      expect(team.teamId).toBe(defaultTeamId);
      expect(team.slug).toBe(live.slug);
      expect(team.plan).toBe(live.billing?.plan ?? null);
      expect(team.dashboardUrl).toBe(`https://vercel.com/${live.slug}`);

      const bySlug = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Team("Team", { slug: live.slug, name: live.name ?? undefined }).pipe(
            adopt(true),
          );
        }),
      );
      expect(bySlug.teamId).toBe(defaultTeamId);
      expect(bySlug.name).toBe(live.name);

      yield* stack.destroy();

      const after = yield* teams.getTeam({ teamId: defaultTeamId });
      expect(after.id).toBe(defaultTeamId);
      expect(after.name).toBe(live.name);
    }).pipe(logLevel),
  { tags: ["provider:vercel", "provider:vercel:team", "live"], timeout: 120_000 },
);
