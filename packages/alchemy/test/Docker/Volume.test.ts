import { describe, expect } from "alchemy-test";
import * as Effect from "effect/Effect";
import { adopt, OwnedBySomeoneElse } from "@/AdoptPolicy.ts";
import * as Docker from "@/Docker";
import * as Provider from "@/Provider";
import { inMemoryState } from "@/State";
import * as Test from "@/Test/Alchemy";

const { test } = Test.make({ providers: Docker.providers(), state: inMemoryState() });

test.provider(
  "diff replaces a volume when labels change",
  () =>
    Effect.gen(function* () {
      const volumeProvider = yield* Provider.findProvider(Docker.Volume);
      const volumeDiff = yield* volumeProvider.diff!({
        id: "data",
        fqn: "data",
        instanceId: "instance",
        olds: { name: "data", labels: { usage: "old" } },
        news: { name: "data", labels: { usage: "new" } },
        oldBindings: [],
        newBindings: [],
        output: {
          id: "data",
          name: "data",
          driver: "local",
          driverOpts: {},
          labels: { usage: "old" },
          mountpoint: undefined,
          createdAt: 0,
        },
      });
      expect(volumeDiff).toEqual({ action: "replace", deleteFirst: true });
    }),
  { tags: ["provider:docker", "provider:docker:volume", "local"] },
);

test.provider(
  "diff replaces a volume when its Docker context changes",
  () =>
    Effect.gen(function* () {
      const volumeProvider = yield* Provider.findProvider(Docker.Volume);
      const volumeDiff = yield* volumeProvider.diff!({
        id: "data",
        fqn: "data",
        instanceId: "instance",
        olds: { name: "data", context: "default" },
        news: { name: "data", context: "remote-build" },
        oldBindings: [],
        newBindings: [],
        output: {
          id: "data",
          name: "data",
          driver: "local",
          driverOpts: {},
          labels: {},
          mountpoint: undefined,
          createdAt: 0,
        },
      });
      expect(volumeDiff).toEqual({ action: "replace", deleteFirst: true });
    }),
  { tags: ["provider:docker", "provider:docker:volume", "local"] },
);

describe(
  "Docker.Volume",
  { tags: ["provider:docker", "provider:docker:volume", "local"], concurrent: false },
  () => {
    // Every prop is optional: `Docker.Volume("data")` must plan, deploy,
    // redeploy in place, and destroy without a props object.
    test.provider("deploys a volume declared without props", (stack) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;
        yield* stack.destroy();
        const first = yield* stack.deploy(Docker.Volume("bare-volume"));
        expect(first.driver).toBe("local");
        const second = yield* stack.deploy(Docker.Volume("bare-volume"));
        expect(second.createdAt).toBe(first.createdAt);
        yield* stack.destroy();
        const gone = yield* docker.volume.inspect(first.name).pipe(Effect.flip);
        expect(gone.reason._tag).toBe("NotFound");
      }),
    );

    test.provider("creates a volume with labels", (stack) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;
        const volumeName = "alchemy-test-volume-create";
        yield* Effect.addFinalizer(() => docker.volume.remove(volumeName).pipe(Effect.ignore));
        const volume = yield* stack.deploy(
          Docker.Volume("created-volume", {
            name: volumeName,
            labels: { "com.alchemy.test": "true" },
          }),
        );
        expect(volume.name).toBe(volumeName);
        expect(volume.id).toBe(volumeName);
        expect(volume.driver).toBe("local");
        expect(volume.labels["com.alchemy.test"]).toBe("true");
        expect(volume.mountpoint?.length).toBeGreaterThan(0);
      }),
    );

    test.provider("adopts an existing Docker volume", (stack) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;
        const volumeName = "alchemy-test-volume-adopt-existing";
        yield* Effect.addFinalizer(() => docker.volume.remove(volumeName).pipe(Effect.ignore));
        yield* docker.volume
          .remove(volumeName)
          .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));
        yield* docker.volume.create({ name: volumeName });

        const error = yield* stack
          .deploy(Docker.Volume("existing-volume", { name: volumeName }))
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(OwnedBySomeoneElse);
        const volume = yield* stack.deploy(
          Docker.Volume("existing-volume", { name: volumeName }).pipe(adopt(true)),
        );
        expect(volume.name).toBe(volumeName);
        expect(volume.id).toBe(volumeName);
        expect(volume.driver).toBe("local");
      }),
    );

    test.provider("replaces a volume when its labels change", (stack) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;
        const volumeName = "alchemy-test-volume-replace";
        yield* docker.volume
          .remove(volumeName)
          .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));
        const first = yield* stack.deploy(
          Docker.Volume("replaceable-volume", { labels: { generation: "1" } }),
        );
        const second = yield* stack.deploy(
          Docker.Volume("replaceable-volume", { labels: { generation: "2" } }),
        );
        expect(second.id).not.toBe(first.id);
        expect(second.labels.generation).toBe("2");
      }),
    );

    test.provider(
      "replaces a volume whose labels change while its context is re-created",
      (stack) =>
        Effect.gen(function* () {
          const docker = yield* Docker.Docker;
          const program = (generation: string) =>
            Effect.gen(function* () {
              const context = yield* Docker.Context("volume-context", {
                docker: "host=unix:///var/run/docker.sock",
              });
              const volume = yield* Docker.Volume("context-volume", {
                context,
                labels: { generation },
              });
              return { context, volume };
            });

          yield* stack.destroy();
          const first = yield* stack.deploy(program("1"));
          yield* docker.context.remove(first.context.name, true);

          const plan = yield* stack.plan(program("2"));
          expect(plan.resources["volume-context"]).toMatchObject({ action: "update" });
          expect(plan.resources["context-volume"]).toMatchObject({ action: "replace" });

          const second = yield* stack.deploy(program("2"));
          expect(second.volume.name).not.toBe(first.volume.name);
          const live = yield* docker.volume.inspect(second.volume.name, second.context.name);
          expect(live.Labels?.generation).toBe("2");
          const old = yield* docker.volume.inspect(first.volume.name).pipe(Effect.flip);
          expect(old.reason._tag).toBe("NotFound");

          yield* stack.destroy();
          const gone = yield* docker.volume.inspect(second.volume.name).pipe(Effect.flip);
          expect(gone.reason._tag).toBe("NotFound");
        }),
    );
  },
);
