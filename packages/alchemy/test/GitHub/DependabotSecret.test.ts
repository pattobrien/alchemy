import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { MinimumLogLevel } from "effect/References";
import * as GitHub from "@/GitHub";
import { Octokit, unlessStatus } from "@/GitHub/Octokit.ts";
import * as Test from "@/Test/Alchemy";

const { test } = Test.make({ providers: GitHub.providers() });

const logLevel = Effect.provideService(MinimumLogLevel, process.env.DEBUG ? "Debug" : "Info");

const owner = process.env.GITHUB_TEST_OWNER ?? "alchemy-run-test";
const repository = process.env.GITHUB_TEST_REPOSITORY ?? "test-repo";

const dependabotSecretUpdatedAt = (name: string) =>
  Effect.gen(function* () {
    const octokit = yield* Octokit;
    const response = yield* unlessStatus([404], () =>
      octokit.rest.dependabot.getRepoSecret({ owner, repo: repository, secret_name: name }),
    );
    return response?.data.updated_at;
  });

const actionsSecretExists = (name: string) =>
  Effect.gen(function* () {
    const octokit = yield* Octokit;
    const response = yield* unlessStatus([404], () =>
      octokit.rest.actions.getRepoSecret({ owner, repo: repository, secret_name: name }),
    );
    return response !== undefined;
  });

test.provider.skipIf(!owner)(
  "DependabotSecret stores the value in the Dependabot store and removes it on destroy",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const secret = yield* stack.deploy(
        GitHub.DependabotSecret("DependabotSecret", {
          owner,
          repository,
          name: "ALCHEMY_DEPENDABOT_SECRET",
          value: Redacted.make("hunter2"),
        }),
      );

      expect(secret.updatedAt).toEqual(
        yield* dependabotSecretUpdatedAt("ALCHEMY_DEPENDABOT_SECRET"),
      );
      expect(yield* actionsSecretExists("ALCHEMY_DEPENDABOT_SECRET")).toBe(false);

      yield* stack.destroy();

      expect(yield* dependabotSecretUpdatedAt("ALCHEMY_DEPENDABOT_SECRET")).toBeUndefined();
    }).pipe(logLevel),
  {
    tags: ["provider:github", "provider:github:dependabot-secret", "live"],
    timeout: 120_000,
  },
);
