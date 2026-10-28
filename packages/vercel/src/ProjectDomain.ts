import * as projects from "@distilled.cloud/vercel/projects";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";

export type RedirectStatusCode = projects.AddProjectDomainRequestRedirectStatusCode;

export interface ProjectDomainProps {
  /**
   * ID or name of the project that serves the domain, e.g. `project.projectId`.
   * Changing it triggers a replacement.
   */
  project: string;
  /**
   * Team that owns the project, e.g. `team.teamId`. Defaults to the access
   * token's default scope. Changing it triggers a replacement.
   */
  teamId?: string;
  /**
   * Fully qualified domain name, e.g. `www.example.com` or
   * `my-app.vercel.app`. Changing it triggers a replacement.
   */
  name: string;
  /**
   * Git branch whose deployments the domain serves. `undefined` serves
   * production deployments.
   */
  gitBranch?: string;
  /**
   * Domain to redirect to instead of serving the project.
   */
  redirect?: string;
  /**
   * HTTP status code used for `redirect`.
   * @default 307
   */
  redirectStatusCode?: RedirectStatusCode;
}

export interface ProjectDomainVerification {
  /** Record type of the challenge, e.g. `TXT`. */
  type: string;
  /** Hostname the record must be published on. */
  domain: string;
  /** Record value. */
  value: string;
  /** Why verification is required. */
  reason: string;
}

export interface ProjectDomainAttributes {
  /** Fully qualified domain name. */
  name: string;
  /** Apex domain, e.g. `example.com`. */
  apexName: string;
  /** ID of the project that serves the domain. */
  projectId: string;
  /** Team the domain was requested under, if any. */
  teamId: string | undefined;
  /** Git branch whose deployments the domain serves, or `null` for production. */
  gitBranch: string | null;
  /** Redirect target, or `null`. */
  redirect: string | null;
  /** Redirect status code, or `null`. */
  redirectStatusCode: RedirectStatusCode | null;
  /** Whether Vercel has verified the domain for this project. */
  verified: boolean;
  /** DNS challenges to complete while `verified` is `false`. */
  verification: ProjectDomainVerification[];
}

export interface ProjectDomain extends Resource<
  "Vercel.ProjectDomain",
  ProjectDomainProps,
  ProjectDomainAttributes,
  never,
  Providers
> {}

/**
 * A domain assigned to a Vercel project.
 *
 * Domains outside Vercel DNS stay unverified until the records in
 * `verification` are published at the domain's DNS host. `*.vercel.app`
 * subdomains are verified immediately.
 *
 * A domain already assigned to the project before the first deploy is
 * reported as unowned and requires `Alchemy.adopt(true)`. That includes the
 * `<project-name>.vercel.app` domain Vercel assigns to every new project.
 *
 * ### Assigning a domain
 * **Example:** Production domain
 * ```typescript
 * const project = yield* Vercel.Project("Web", { framework: "nextjs" });
 * const domain = yield* Vercel.ProjectDomain("WebDomain", {
 *   project: project.projectId,
 *   name: "www.example.com",
 * });
 * ```
 *
 * **Example:** Branch preview domain
 * ```typescript
 * const project = yield* Vercel.Project("Web", {
 *   gitRepository: { type: "github", repo: "my-org/my-repo" },
 * });
 * yield* Vercel.ProjectDomain("StagingDomain", {
 *   project: project.projectId,
 *   name: "staging.example.com",
 *   gitBranch: "staging",
 * });
 * ```
 *
 * ### Redirecting
 * **Example:** Redirect the apex to `www`
 * ```typescript
 * const project = yield* Vercel.Project("Web", { framework: "nextjs" });
 * yield* Vercel.ProjectDomain("Apex", {
 *   project: project.projectId,
 *   name: "example.com",
 *   redirect: "www.example.com",
 *   redirectStatusCode: 308,
 * });
 * ```
 *
 * @resource
 * @product Domain
 */
export const ProjectDomain = Resource<ProjectDomain>("Vercel.ProjectDomain");

export class RedirectStatusCodeWithoutRedirect extends Data.TaggedError(
  "RedirectStatusCodeWithoutRedirect",
)<{
  message: string;
}> {}

const getDomain = Effect.fn(function* (
  project: string,
  domain: string,
  teamId: string | undefined,
) {
  const observed = yield* projects.getProjectDomain({ idOrName: project, domain, teamId });
  return {
    name: observed.name,
    apexName: observed.apexName,
    projectId: observed.projectId,
    teamId,
    gitBranch: observed.gitBranch ?? null,
    redirect: observed.redirect ?? null,
    redirectStatusCode: observed.redirectStatusCode ?? null,
    verified: observed.verified,
    verification: (observed.verification ?? []).map(({ type, domain, value, reason }) => ({
      type,
      domain,
      value,
      reason,
    })),
  } satisfies ProjectDomainAttributes;
});

const observeDomain = (project: string, domain: string, teamId: string | undefined) =>
  getDomain(project, domain, teamId).pipe(
    Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
  );

export const ProjectDomainProvider = () =>
  Provider.succeed(ProjectDomain, {
    stables: ["name", "apexName", "projectId"],
    diff: Effect.fn(function* ({ olds, news }) {
      if (!isResolved(news)) return;
      if (news.name !== olds.name) return { action: "replace" } as const;
      if (news.project !== olds.project || news.teamId !== olds.teamId) {
        return { action: "replace", deleteFirst: true } as const;
      }
    }),
    read: Effect.fn(function* ({ olds, output }) {
      if (output) return yield* observeDomain(output.projectId, output.name, output.teamId);
      const attrs = yield* observeDomain(olds.project, olds.name, olds.teamId);
      return attrs && Unowned(attrs);
    }),
    reconcile: Effect.fn(function* ({ news }) {
      if (news.redirectStatusCode !== undefined && news.redirect === undefined) {
        return yield* new RedirectStatusCodeWithoutRedirect({
          message: `Vercel.ProjectDomain "${news.name}" sets redirectStatusCode without redirect; set redirect or remove redirectStatusCode`,
        });
      }
      let observed = yield* observeDomain(news.project, news.name, news.teamId);
      if (!observed) {
        yield* projects
          .addProjectDomain({
            idOrName: news.project,
            teamId: news.teamId,
            name: news.name,
            gitBranch: news.gitBranch,
            redirect: news.redirect,
            redirectStatusCode: news.redirectStatusCode,
          })
          .pipe(
            Effect.catchTag("Conflict", (error) =>
              observeDomain(news.project, news.name, news.teamId).pipe(
                Effect.flatMap((domain) => (domain ? Effect.void : Effect.fail(error))),
              ),
            ),
          );
        observed = yield* getDomain(news.project, news.name, news.teamId);
      }
      const gitBranch = news.gitBranch ?? null;
      const redirect = news.redirect ?? null;
      const redirectStatusCode = redirect ? (news.redirectStatusCode ?? 307) : null;
      if (
        observed.gitBranch !== gitBranch ||
        observed.redirect !== redirect ||
        observed.redirectStatusCode !== redirectStatusCode
      ) {
        yield* projects.updateProjectDomain({
          idOrName: news.project,
          domain: news.name,
          teamId: news.teamId,
          gitBranch,
          redirect,
          redirectStatusCode,
        });
        observed = yield* getDomain(news.project, news.name, news.teamId);
      }
      return observed;
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* projects
        .removeProjectDomain({
          idOrName: output.projectId,
          domain: output.name,
          teamId: output.teamId,
        })
        .pipe(Effect.catchTag("NotFound", () => Effect.void));
    }),
  });
