import * as teams from "@distilled.cloud/vercel/teams";
import * as user from "@distilled.cloud/vercel/user";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";

export type TeamPlan = teams.TeamBillingPlan;

export interface TeamProps {
  /**
   * Slug or ID of an existing Vercel team. Defaults to the access token's
   * default team. Changing it targets a different team and triggers a
   * replacement.
   */
  slug?: string;
  /**
   * Display name of the team. Left unchanged when omitted.
   */
  name?: string;
  /**
   * Short description of the team. Left unchanged when omitted.
   */
  description?: string;
}

export interface TeamAttributes {
  /** Vercel team ID, e.g. `team_abc123`. */
  teamId: string;
  /** Team slug, unique across Vercel. */
  slug: string;
  /** Display name of the team. */
  name: string | null;
  /** Short description of the team. */
  description: string | null;
  /**
   * Billing plan tier (`hobby`, `pro`, or `enterprise`). Read-only: the plan
   * cannot be changed through the Vercel API.
   */
  plan: TeamPlan | null;
  /** Team dashboard URL. */
  dashboardUrl: string;
}

export interface Team extends Resource<
  "Vercel.Team",
  TeamProps,
  TeamAttributes,
  never,
  Providers
> {}

/**
 * An existing Vercel team (account), with its billing plan.
 *
 * The resource never creates or deletes a team. It observes the team named by
 * `slug` (or the token's default team) and keeps its `name` and `description`
 * in sync when they are set. Destroying the resource leaves the team in place.
 *
 * A team always exists before the first deploy, so the first deploy requires
 * explicit adoption with `Alchemy.adopt(true)`.
 *
 * The plan tier is a read-only attribute. Spend Management is not exposed by
 * the Vercel REST API, so it is neither read nor written.
 *
 * ### Referencing a team
 * **Example:** Adopt a team by slug
 * ```typescript
 * const team = yield* Vercel.Team("Team", {
 *   slug: "my-team",
 * }).pipe(Alchemy.adopt(true));
 * ```
 *
 * **Example:** Adopt the token's default team
 * ```typescript
 * const team = yield* Vercel.Team("Team", {}).pipe(Alchemy.adopt(true));
 * ```
 *
 * ### Managing team details
 * **Example:** Set the display name and description
 * ```typescript
 * const team = yield* Vercel.Team("Team", {
 *   slug: "my-team",
 *   name: "My Team",
 *   description: "Production apps",
 * }).pipe(Alchemy.adopt(true));
 * ```
 *
 * @resource
 * @product Team
 */
export const Team = Resource<Team>("Vercel.Team");

export class TeamNotResolved extends Data.TaggedError("TeamNotResolved")<{
  message: string;
}> {}

const resolveTeamId = Effect.fn(function* (slug: string | undefined) {
  if (slug) return slug;
  const { user: me } = yield* user.getAuthUser({});
  if (!me.defaultTeamId) {
    return yield* new TeamNotResolved({
      message: "The Vercel access token has no default team; set `slug` on Vercel.Team",
    });
  }
  return me.defaultTeamId;
});

const observeTeam = Effect.fn(function* (teamId: string) {
  const team = yield* teams.getTeam({ teamId });
  return {
    teamId: team.id,
    slug: team.slug,
    name: team.name,
    description: team.description,
    plan: team.billing?.plan ?? null,
    dashboardUrl: `https://vercel.com/${team.slug}`,
  } satisfies TeamAttributes;
});

export const TeamProvider = () =>
  Provider.succeed(Team, {
    stables: ["teamId"],
    diff: Effect.fn(function* ({ olds, news }) {
      if (!isResolved(news)) return;
      if (news.slug !== olds.slug) return { action: "replace" } as const;
    }),
    read: Effect.fn(function* ({ olds, output }) {
      const teamId = output?.teamId ?? (yield* resolveTeamId(olds?.slug));
      const attrs = yield* observeTeam(teamId);
      return output ? attrs : Unowned(attrs);
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const teamId = output?.teamId ?? (yield* resolveTeamId(news.slug));
      const observed = yield* observeTeam(teamId);
      const name = news.name !== undefined && news.name !== observed.name ? news.name : undefined;
      const description =
        news.description !== undefined && news.description !== observed.description
          ? news.description
          : undefined;
      if (name === undefined && description === undefined) return observed;
      yield* teams.updateTeam({ teamId: observed.teamId, name, description });
      return yield* observeTeam(observed.teamId);
    }),
    delete: () => Effect.void,
  });
