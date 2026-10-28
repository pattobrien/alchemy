# @alchemy.run/vercel

[Vercel](https://vercel.com) for [Alchemy](https://alchemy.run). Record which Vercel team owns a project, which Git repository it builds from, and which domains it serves.

```sh
npm install alchemy @alchemy.run/vercel effect
```

A team, a project built from a monorepo app, and its production domain:

```typescript
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as Vercel from "@alchemy.run/vercel";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "Web",
  {
    providers: Vercel.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const team = yield* Vercel.Team("Team", { slug: "my-team" }).pipe(Alchemy.adopt(true));

    const project = yield* Vercel.Project("Web", {
      teamId: team.teamId,
      framework: "nextjs",
      rootDirectory: "apps/web",
      gitRepository: { type: "github", repo: "my-org/my-repo" },
    });

    const domain = yield* Vercel.ProjectDomain("WebDomain", {
      project: project.projectId,
      teamId: team.teamId,
      name: "www.example.com",
    });

    return {
      plan: team.plan,
      projectId: project.projectId,
      verified: domain.verified,
    };
  }),
);
```

Set `VERCEL_TOKEN` in CI, or run `alchemy profile edit --add Vercel` to store a token in a profile.
