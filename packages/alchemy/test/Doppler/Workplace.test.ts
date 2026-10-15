import {
  createConfig,
  deleteConfig,
  fromApiKey,
  getConfig,
  getEnvironment,
  getProject,
  getSecret,
  listSecrets,
  getV3workplaceserviceAccountsserviceAccountServiceAccountIdentitiesidentityIdentity as getIdentity,
  projectMembersList,
  serviceAccountsGet,
  serviceAccountTokensGet,
  serviceTokensList,
  updateSecret,
} from "@distilled.cloud/doppler";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Unowned } from "@/AdoptPolicy";
import * as Doppler from "@/Doppler";
import * as Output from "@/Output";
import * as Provider from "@/Provider";
import * as Test from "@/Test/Alchemy";

const { test } = Test.make({ providers: Doppler.providers() });

const hasDopplerCreds = !!process.env.DOPPLER_TOKEN;
const suffix = crypto.randomUUID().slice(0, 8);

const allNoop = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).every((node) => node.action === "noop");

const reveal = (value: string | Redacted.Redacted<string> | null | undefined) =>
  Redacted.isRedacted(value) ? Redacted.value(value) : value;

const tagOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => "Found"),
    Effect.catch((error) => Effect.succeed(error._tag)),
  );

const secret = (project: string, config: string, name: string) =>
  getSecret({ project, config, name }).pipe(
    Effect.map(({ value }) => ({ raw: reveal(value?.raw), computed: reveal(value?.computed) })),
  );

const computedSecrets = (project: string, config: string) =>
  listSecrets({ project, config }).pipe(
    Effect.map(({ secrets = {} }) =>
      Object.fromEntries(
        Object.entries(secrets)
          .filter(([name]) => !name.startsWith("DOPPLER_"))
          .map(([name, value]) => [name, reveal(value?.computed)]),
      ),
    ),
  );

const member = (project: string, slug: string) =>
  projectMembersList({ project }).pipe(
    Effect.map(({ members = [] }) => members.find((m) => m.slug === slug)),
    Effect.map((m) => m && { role: m.role?.identifier, environments: m.environments?.toSorted() }),
  );

test.provider.skipIf(!hasDopplerCreds)(
  "builds and destroys a project, environment, configs, secrets and a scoped service account",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const projectName = `probe-${suffix}`;
      const reference = `\${${projectName}.pr.API_KEY}`;

      const workplace = (version: 1 | 2) =>
        Effect.gen(function* () {
          const project = yield* Doppler.Project("Probe", { name: projectName });
          const pr = yield* Doppler.Environment("Pr", {
            project: project.slug,
            slug: "pr",
            name: "Pull Request",
          });
          const personal = yield* Doppler.Config("DevPersonal", {
            project: project.slug,
            environment: "dev",
            name: "dev_personal",
          });
          const branch = yield* Doppler.Config("DevProbe", {
            project: project.slug,
            environment: "dev",
            name: "dev_probe",
          });
          const apiKey = yield* Doppler.Secret("ApiKey", {
            project: project.slug,
            config: pr.slug,
            name: "API_KEY",
            value: Redacted.make(`probe-value-${version}`),
            note: "probe",
          });
          yield* Doppler.Secret("ApiKeyRef", {
            project: project.slug,
            config: branch.name,
            name: "API_KEY_REF",
            value: Output.interpolate`\${${project.slug}.${apiKey.config}.${apiKey.name}}`,
          });
          const account = yield* Doppler.ServiceAccount("ProbeSa", {
            name: `probe-sa-${suffix}`,
            workplaceRole: "collaborator",
          });
          const identity = yield* Doppler.ServiceAccountIdentity("ProbeSaOidc", {
            serviceAccount: account.slug,
            name: "github-actions",
            discoveryUrl: "https://token.actions.githubusercontent.com",
            claimsType: "wildcard",
            claims: {
              aud: ["https://github.com/pattobrien"],
              sub: [`repo:pattobrien/probe-${version}:*`],
            },
            ttlSeconds: 3600,
          });
          const accountToken = yield* Doppler.ServiceAccountToken("ProbeSaToken", {
            serviceAccount: account.slug,
            name: "probe",
          });
          const serviceToken = yield* Doppler.ServiceToken("ProbeReader", {
            project: project.slug,
            config: pr.slug,
            name: "probe-reader",
            access: "read",
          });
          yield* Doppler.ProjectMember("ProbeSaAccess", {
            project: project.slug,
            memberType: "service_account",
            memberSlug: account.slug,
            role: "viewer",
            environments: version === 1 ? [pr.slug] : [pr.slug, "stg"],
          });
          return {
            project: project.slug,
            personalRoot: personal.root,
            secretConfig: apiKey.config,
            account: account.slug,
            identity: identity.slug,
            accountToken,
            serviceToken,
          };
        });

      const v1 = yield* stack.deploy(workplace(1));
      expect(v1).toMatchObject({ project: projectName, personalRoot: false, secretConfig: "pr" });
      expect(
        (yield* getEnvironment({ project: v1.project, environment: "pr" })).environment,
      ).toMatchObject({ id: "pr", name: "Pull Request" });
      expect(yield* tagOf(getConfig({ project: v1.project, config: "dev_probe" }))).toBe("Found");
      expect(yield* secret(v1.project, "pr", "API_KEY")).toEqual({
        raw: "probe-value-1",
        computed: "probe-value-1",
      });
      expect(yield* secret(v1.project, "dev_probe", "API_KEY_REF")).toEqual({
        raw: reference,
        computed: "probe-value-1",
      });
      expect(yield* member(v1.project, v1.account)).toEqual({
        role: "viewer",
        environments: ["pr"],
      });
      expect(
        yield* tagOf(getIdentity({ service_account: v1.account, identity: v1.identity })),
      ).toBe("Found");
      expect(
        yield* tagOf(
          serviceAccountTokensGet({ service_account: v1.account, api_token: v1.accountToken.slug }),
        ),
      ).toBe("Found");
      expect(
        (yield* serviceTokensList({ project: v1.project, config: "pr" })).tokens?.map(
          (t) => t.slug,
        ),
      ).toContain(v1.serviceToken.slug);
      const asServiceToken = fromApiKey({ apiKey: v1.serviceToken.key });
      expect(
        yield* secret(v1.project, "pr", "API_KEY").pipe(Effect.provide(asServiceToken)),
      ).toEqual({ raw: "probe-value-1", computed: "probe-value-1" });
      const asAccount = fromApiKey({ apiKey: v1.accountToken.apiKey });
      expect(yield* secret(v1.project, "pr", "API_KEY").pipe(Effect.provide(asAccount))).toEqual({
        raw: "probe-value-1",
        computed: "probe-value-1",
      });
      expect(
        yield* tagOf(
          secret(v1.project, "dev_probe", "API_KEY_REF").pipe(Effect.provide(asAccount)),
        ),
      ).toBe("BadRequest");
      expect(allNoop(yield* stack.plan(workplace(1)))).toBe(true);

      const v2 = yield* stack.deploy(workplace(2));
      expect(v2.account).toBe(v1.account);
      expect(v2.identity).toBe(v1.identity);
      expect(v2.accountToken.slug).toBe(v1.accountToken.slug);
      expect(yield* secret(v2.project, "dev_probe", "API_KEY_REF")).toEqual({
        raw: reference,
        computed: "probe-value-2",
      });
      expect(yield* member(v2.project, v2.account)).toEqual({
        role: "viewer",
        environments: ["pr", "stg"],
      });

      yield* stack.destroy();
      expect(yield* tagOf(getProject({ project: projectName }))).toBe("NotFound");
      expect(yield* tagOf(serviceAccountsGet({ slug: v1.account }))).toBe("NotFound");
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasDopplerCreds)(
  "renames an environment slug in place",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const projectName = `probe-rename-${suffix}`;

      const workplace = (slug: string) =>
        Effect.gen(function* () {
          const project = yield* Doppler.Project("Probe", { name: projectName });
          yield* Doppler.Environment("Release", { project: project.slug, slug, name: "Release" });
          return project.slug;
        });

      const project = yield* stack.deploy(workplace("rel"));
      yield* updateSecret({ project, config: "rel", secrets: { KEPT: "kept" } });
      yield* stack.deploy(workplace("release"));
      expect(yield* secret(project, "release", "KEPT")).toEqual({ raw: "kept", computed: "kept" });
      expect(yield* tagOf(getEnvironment({ project, environment: "rel" }))).toBe("NotFound");
      expect(
        (yield* getEnvironment({ project, environment: "release" })).environment,
      ).toMatchObject({
        id: "release",
        name: "Release",
      });

      yield* stack.destroy();
      expect(yield* tagOf(getProject({ project }))).toBe("NotFound");
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasDopplerCreds)(
  "reads a branch config through a token scoped to its environment",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const { project, apiKey } = yield* stack.deploy(
        Effect.gen(function* () {
          const project = yield* Doppler.Project("Probe", { name: `probe-scoped-${suffix}` });
          const account = yield* Doppler.ServiceAccount("ScopedSa", {
            name: `probe-scoped-sa-${suffix}`,
            workplaceRole: "collaborator",
          });
          yield* Doppler.ProjectMember("ScopedSaAccess", {
            project: project.slug,
            memberType: "service_account",
            memberSlug: account.slug,
            role: "collaborator",
            environments: ["dev"],
          });
          const token = yield* Doppler.ServiceAccountToken("ScopedSaToken", {
            serviceAccount: account.slug,
            name: "probe",
          });
          return { project: project.slug, apiKey: token.apiKey };
        }),
      );
      const asAccount = fromApiKey({ apiKey });
      const props = { project, environment: "dev", name: "dev_scoped" };
      const read = Effect.gen(function* () {
        const provider = yield* Provider.findProvider(Doppler.Config);
        return yield* provider.read!({
          id: "Scoped",
          fqn: "Scoped",
          instanceId: "Scoped",
          olds: props,
          output: undefined,
        });
      });

      expect(
        yield* tagOf(getConfig({ project, config: props.name }).pipe(Effect.provide(asAccount))),
      ).toBe("BadRequest");
      expect(yield* read.pipe(Effect.provide(asAccount))).toBeUndefined();
      yield* createConfig(props).pipe(Effect.provide(asAccount));
      const found = yield* read.pipe(Effect.provide(asAccount));
      expect(found).toMatchObject({ ...props, root: false });
      expect(Unowned.is(found)).toBe(true);

      yield* deleteConfig({ project, config: props.name });
      yield* stack.destroy();
    }),
  { timeout: 120_000 },
);

test.provider.skipIf(!hasDopplerCreds)(
  "inherits secrets from inheritable configs into a root and a branch config",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const sharedName = `probe-shared-${suffix}`;
      const appName = `probe-app-${suffix}`;

      const workplace = (version: 1 | 2 | 3 | 4) =>
        Effect.gen(function* () {
          const sharedProject = yield* Doppler.Project("Shared", { name: sharedName });
          const sharedEnv = yield* Doppler.Environment("SharedPr", {
            project: sharedProject.slug,
            slug: "pr",
            name: "Pull Request",
          });
          const sharedPr = yield* Doppler.Config("SharedPrConfig", {
            project: sharedProject.slug,
            environment: sharedEnv.slug,
            name: sharedEnv.slug,
            inheritable: true,
          });
          const sharedStg = yield* Doppler.Config("SharedStgConfig", {
            project: sharedProject.slug,
            environment: "stg",
            name: "stg",
            inheritable: true,
          });
          const source = yield* Doppler.Secret("Source", {
            project: sharedProject.slug,
            config: "prd",
            name: "SOURCE",
            value: Redacted.make("from-prd"),
          });
          yield* Doppler.Secret("SharedPlain", {
            project: sharedPr.project,
            config: sharedPr.name,
            name: "SHARED_PLAIN",
            value: Redacted.make("plain"),
          });
          yield* Doppler.Secret("SharedRef", {
            project: sharedPr.project,
            config: sharedPr.name,
            name: "SHARED_REF",
            value: Output.interpolate`\${${source.project}.${source.config}.${source.name}}`,
          });
          yield* Doppler.Secret("StgOnly", {
            project: sharedStg.project,
            config: sharedStg.name,
            name: "STG_ONLY",
            value: Redacted.make("stg"),
          });
          const appProject = yield* Doppler.Project("App", { name: appName });
          const appEnv = yield* Doppler.Environment("AppPr", {
            project: appProject.slug,
            slug: "pr",
            name: "Pull Request",
          });
          const pr = { project: sharedPr.project, config: sharedPr.name };
          const stg = { project: sharedStg.project, config: sharedStg.name };
          const root = yield* Doppler.Config("AppPrConfig", {
            project: appProject.slug,
            environment: appEnv.slug,
            name: appEnv.slug,
            inherits: version === 4 ? [] : [pr],
          });
          const branch = yield* Doppler.Config("AppPrBranch", {
            project: root.project,
            environment: root.environment,
            name: "pr_1",
            inherits: version === 1 ? undefined : version === 2 ? [stg] : [],
          });
          return {
            sharedInheritable: [sharedPr.inheritable, sharedStg.inheritable],
            app: appProject.slug,
            root: root.inherits,
            branch: branch.inherits,
          };
        });

      const live = (project: string) =>
        Effect.gen(function* () {
          const inherits = (config: string) =>
            getConfig({ project, config }).pipe(
              Effect.map((response) => response.config?.inherits?.map((ref) => ref.config)),
            );
          return {
            root: {
              inherits: yield* inherits("pr"),
              secrets: yield* computedSecrets(project, "pr"),
            },
            branch: {
              inherits: yield* inherits("pr_1"),
              secrets: yield* computedSecrets(project, "pr_1"),
            },
          };
        });
      const fromPr = { SHARED_PLAIN: "plain", SHARED_REF: "from-prd" };
      const shared = (config: string) => [{ project: sharedName, config }];

      const v1 = yield* stack.deploy(workplace(1));
      expect(v1).toEqual({
        sharedInheritable: [true, true],
        app: appName,
        root: shared("pr"),
        branch: shared("pr"),
      });
      expect(yield* live(v1.app)).toEqual({
        root: { inherits: ["pr"], secrets: fromPr },
        branch: { inherits: ["pr"], secrets: fromPr },
      });
      expect(allNoop(yield* stack.plan(workplace(1)))).toBe(true);

      expect((yield* stack.deploy(workplace(2))).branch).toEqual(shared("stg"));
      expect(yield* live(v1.app)).toEqual({
        root: { inherits: ["pr"], secrets: fromPr },
        branch: { inherits: ["stg"], secrets: { STG_ONLY: "stg" } },
      });

      expect((yield* stack.deploy(workplace(3))).branch).toEqual([]);
      expect(yield* live(v1.app)).toEqual({
        root: { inherits: ["pr"], secrets: fromPr },
        branch: { inherits: [], secrets: {} },
      });

      expect((yield* stack.deploy(workplace(4))).root).toEqual([]);
      expect(yield* live(v1.app)).toEqual({
        root: { inherits: [], secrets: {} },
        branch: { inherits: [], secrets: {} },
      });

      yield* stack.destroy();
      expect(yield* tagOf(getProject({ project: sharedName }))).toBe("NotFound");
      expect(yield* tagOf(getProject({ project: appName }))).toBe("NotFound");
    }),
  { timeout: 180_000 },
);
