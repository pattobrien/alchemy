import { getProject, getWorkplace, listUsers } from "@distilled.cloud/doppler";
import { expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Unowned } from "@/AdoptPolicy";
import * as Doppler from "@/Doppler";
import { createReminder, readReminder } from "@/Doppler/WebFlows.ts";
import * as Provider from "@/Provider";
import * as Test from "@/Test/Alchemy";

const { test } = Test.make({ providers: Doppler.providers({ browser: true }) });

const hasDopplerCreds = !!process.env.DOPPLER_TOKEN;
const suffix = crypto.randomUUID().slice(0, 8);

const allNoop = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).every((node) => node.action === "noop");

const tagOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => "Found"),
    Effect.catch((error) => Effect.succeed(error._tag)),
  );

const workplaceId = getWorkplace({}).pipe(
  Effect.flatMap(({ workplace }) => Effect.fromNullishOr(workplace?.id)),
);

const firstUserId = listUsers({ page: 1 }).pipe(
  Effect.flatMap(({ workplace_users = [] }) => Effect.fromNullishOr(workplace_users[0]?.id)),
);

const liveReminder = (project: string, environment: string, secret: string) =>
  Effect.gen(function* () {
    const live = yield* readReminder(
      { workplaceId: yield* workplaceId, project, environment },
      secret,
    );
    return (
      live && {
        description: live.description,
        frequencyDays: live.frequencyDays,
        nextReminderOn: live.nextReminderOn,
        assignees: live.assignees.map(({ type, slug }) => ({ type, slug })),
      }
    );
  });

test.provider.skipIf(!hasDopplerCreds)(
  "creates, updates, reschedules and deletes a reminder, and refuses to take over a foreign one",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const projectName = `probe-reminder-${suffix}`;
      const userId = yield* firstUserId;

      const workplace = (
        reminder:
          | Pick<
              Doppler.SecretReminderProps,
              "description" | "frequencyDays" | "nextReminderOn" | "assignees"
            >
          | undefined,
      ) =>
        Effect.gen(function* () {
          const project = yield* Doppler.Project("Probe", { name: projectName });
          const secret = yield* Doppler.Secret("ApiKey", {
            project: project.slug,
            config: "dev",
            name: "API_KEY",
            value: Redacted.make("dev"),
          });
          if (reminder !== undefined) {
            const live = yield* Doppler.SecretReminder("ApiKeyReminder", {
              project: secret.project,
              environment: "dev",
              secret: secret.name,
              ...reminder,
            });
            return { project: project.slug, reminderId: live.reminderId };
          }
          return { project: project.slug, reminderId: undefined };
        });

      const v1 = yield* stack.deploy(
        workplace({ description: "rotate me", nextReminderOn: "2027-01-01" }),
      );
      expect(v1.reminderId).toBeDefined();
      expect(yield* liveReminder(v1.project, "dev", "API_KEY")).toEqual({
        description: "rotate me",
        frequencyDays: 30,
        nextReminderOn: "2027-01-01",
        assignees: [],
      });
      expect(
        allNoop(
          yield* stack.plan(workplace({ description: "rotate me", nextReminderOn: "2027-01-01" })),
        ),
      ).toBe(true);

      const v2 = yield* stack.deploy(
        workplace({
          description: "rotate me soon",
          frequencyDays: 14,
          nextReminderOn: "2027-01-01",
          assignees: [{ type: "WorkplaceUser", slug: userId }],
        }),
      );
      expect(v2.reminderId).toBe(v1.reminderId);
      expect(yield* liveReminder(v2.project, "dev", "API_KEY")).toEqual({
        description: "rotate me soon",
        frequencyDays: 14,
        nextReminderOn: "2027-01-01",
        assignees: [{ type: "WorkplaceUser", slug: userId }],
      });

      const v3 = yield* stack.deploy(
        workplace({
          description: "rotate me soon",
          frequencyDays: 14,
          nextReminderOn: "2027-02-01",
        }),
      );
      expect(v3.reminderId).toBe(v1.reminderId);
      expect(yield* liveReminder(v3.project, "dev", "API_KEY")).toEqual({
        description: "rotate me soon",
        frequencyDays: 14,
        nextReminderOn: "2027-02-01",
        assignees: [],
      });

      const read = (olds: Doppler.SecretReminderProps) =>
        Effect.gen(function* () {
          const provider = yield* Provider.findProvider(Doppler.SecretReminder);
          return yield* provider.read!({
            id: "ApiKeyReminder",
            fqn: "ApiKeyReminder",
            instanceId: "ApiKeyReminder",
            olds,
            output: undefined,
          });
        });
      const olds: Doppler.SecretReminderProps = {
        project: v3.project,
        environment: "dev",
        secret: "API_KEY",
        description: "rotate me soon",
        frequencyDays: 14,
        nextReminderOn: "2027-02-01",
      };
      expect(yield* read(olds)).toEqual(
        Unowned({
          reminderId: v1.reminderId,
          project: v3.project,
          environment: "dev",
          secret: "API_KEY",
          description: "rotate me soon",
          frequencyDays: 14,
          nextReminderOn: "2027-02-01",
          pastDue: false,
          assignees: [],
        }),
      );
      expect(yield* read({ ...olds, secret: "MISSING" })).toBeUndefined();

      const v4 = yield* stack.deploy(workplace(undefined));
      expect(v4.reminderId).toBeUndefined();
      expect(yield* liveReminder(v4.project, "dev", "API_KEY")).toBeUndefined();

      yield* createReminder(
        { workplaceId: yield* workplaceId, project: v4.project, environment: "dev" },
        "API_KEY",
        {
          description: "made by hand",
          frequencyDays: 7,
          nextReminderOn: "2027-01-01",
          assignees: [],
        },
      );
      expect(
        yield* tagOf(
          stack.deploy(workplace({ description: "managed", nextReminderOn: "2027-01-01" })),
        ),
      ).toBe("OwnedBySomeoneElse");
      expect(yield* liveReminder(v4.project, "dev", "API_KEY")).toEqual({
        description: "made by hand",
        frequencyDays: 7,
        nextReminderOn: "2027-01-01",
        assignees: [],
      });

      yield* stack.destroy();
      expect(yield* tagOf(getProject({ project: projectName }))).toBe("NotFound");
    }),
  { timeout: 300_000 },
);
