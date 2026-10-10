# pattobrien/alchemy

This repository is a fork of [alchemy-run/alchemy](https://github.com/alchemy-run/alchemy). It
publishes to GitHub Packages under the `@pattobrien` scope, so projects can use changes that
upstream has not merged yet.

## What this fork carries

- The Inngest provider in `packages/alchemy/src/Inngest`: `BranchEnvironment`, `App`, `DevServer`,
  `EventKey`, `SigningKey`, and `Webhook`.
- The `GitHub.App` and `GitHub.AppInstallation` resources, and browser launcher fixes in
  `packages/alchemy/src/Browser.ts`.
- The Linear provider in `packages/alchemy/src/Linear`.
- `registry` credentials for a `Cloudflare.Container` pre-built `image`, passed to `Docker.image.pull`.
- Fixes with open upstream PRs: `Artifacts.cached` completes its waiters on failure
  ([#1853](https://github.com/alchemy-run/alchemy/pull/1853)), typed Stack stages
  ([#2131](https://github.com/alchemy-run/alchemy/pull/2131)), `GitHub.Ruleset` adoption
  ([#2129](https://github.com/alchemy-run/alchemy/pull/2129)), and verbatim json bindings in
  Cloudflare Preview deploys ([#2127](https://github.com/alchemy-run/alchemy/pull/2127)).
- `submodules/distilled` points at [pattobrien/distilled](https://github.com/pattobrien/distilled).
- The release workflow `.github/workflows/release-fork.yml` and `scripts/release/fork-publish.ts`.

Remove an item once upstream merges its PR and a sync brings the change in.

## Packages

`alchemy` publishes as `@pattobrien/alchemy`. Each non-private `@alchemy.run/<sub>` publishes as
`@pattobrien/alchemy-<sub>` to `https://npm.pkg.github.com`. Source `package.json` names never
change. At publish time the release script rewrites workspace dependencies to the same fork version,
and each `@distilled.cloud/<pkg>` dependency to `npm:@pattobrien/distilled-<pkg>@<version>`.
`<version>` is the `distilled` field of `scripts/release/fork.json`.

A fork tag is `v<upstream>-fork.N`, and the published version drops the `v`. `<upstream>` is the
shared `version` in `packages/*/package.json`, for example `2.0.0-beta.81`. N increases with every
fork release and never reuses a number that has a tag.

## Cutting a release

1. If pattobrien/distilled has a new fork release, set `distilled` in `scripts/release/fork.json`
   to its version and merge that change into `main`.
2. Type-check `main` with `pnpm exec tsc -b`.
3. To preview the package map and its rewrites, run
   `node scripts/release/fork-publish.ts --dry-run <upstream>-fork.N`.
4. Run `git tag v<upstream>-fork.N <sha>`, then `git push origin v<upstream>-fork.N`.

The tag push starts `release-fork.yml`, which runs `pnpm build:pkg` and publishes each package. The
script skips any package version that is already on the registry.

## Syncing from upstream

Add the upstream remote once with
`git remote add upstream https://github.com/alchemy-run/alchemy.git`.

1. Create a branch from `main`.
2. Run `git fetch upstream`, then `git merge --no-ff upstream/main`.
3. Keep the `submodules/distilled` URL in `.gitmodules` on pattobrien/distilled. Resolve a conflict
   on the submodule pin to a commit on pattobrien/distilled `main`.
4. Open a PR into `main`.

Never rebase or force-push `main` or any pushed branch. After a pattobrien/distilled sync lands,
re-pin the submodule in a PR. Run `git -C submodules/distilled fetch origin`, then
`git -C submodules/distilled checkout origin/main`, then `git add submodules/distilled`.

## Consuming

Add these lines to the project's `.npmrc`. `NODE_AUTH_TOKEN` must hold a GitHub token with the
`read:packages` scope.

```ini
@pattobrien:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Install each package under its upstream name with an npm alias. The alias satisfies peer
dependencies such as the `alchemy` peer of `@pattobrien/alchemy-better-auth`. Replace `N` with the
latest published fork number.

```json
"alchemy": "npm:@pattobrien/alchemy@2.0.0-beta.81-fork.N"
```
