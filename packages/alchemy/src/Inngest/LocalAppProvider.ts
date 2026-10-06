import * as Inngest from "@distilled.cloud/inngest";
import { Credentials } from "@distilled.cloud/inngest/Credentials";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import type { HttpClientError } from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { AppResource, AppSyncFailed, compareFunctions, expectedFunctionSlugs } from "./App.ts";
import { DEFAULT_DEV_SERVER_PORT } from "./DevServer.ts";

export class AppHostUnreachable extends Data.TaggedError("Inngest.AppHostUnreachable")<{
  appId: string;
  url: string;
  message: string;
}> {}

export class AppRemoveFailed extends Data.TaggedError("Inngest.AppRemoveFailed")<{
  devServer: string;
  url: string;
  message: string;
}> {}

const DEFAULT_DEV_SERVER = `http://localhost:${DEFAULT_DEV_SERVER_PORT}`;

const transportErrorAsMissing = (error: HttpClientError) =>
  error.reason._tag === "TransportError" ? Effect.succeed(undefined) : Effect.fail(error);

const devServerCredentials = (devServer: string) =>
  Effect.provideService(
    Credentials,
    Effect.succeed({
      apiKey: Redacted.make("alchemy-dev"),
      apiBaseUrl: `${devServer.replace(/\/$/, "")}/api/v2`,
    }),
  );

export const LocalAppProvider = () =>
  Provider.effect(
    AppResource,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      const register = Effect.fn(
        function* (appId: string, url: string) {
          const res = yield* client
            .execute(HttpClientRequest.put(url))
            .pipe(
              Effect.mapError(
                (error) => new AppHostUnreachable({ appId, url, message: error.message }),
              ),
            );
          const body = yield* res.json.pipe(Effect.orElseSucceed(() => undefined));
          const message =
            typeof body === "object" && body !== null && "message" in body
              ? String(body.message)
              : `HTTP ${res.status}`;
          if (res.status === 502 || res.status === 503 || res.status === 504) {
            return yield* new AppHostUnreachable({ appId, url, message });
          }
          if (res.status < 200 || res.status >= 300) {
            return yield* new AppSyncFailed({ appId, url, message });
          }
        },
        Effect.retry({
          while: (e) => e._tag === "Inngest.AppHostUnreachable",
          schedule: Schedule.spaced("1 second"),
          times: 15,
        }),
      );

      const observeFunctions = (devServer: string, appId: string) =>
        Inngest.getV2Functions.items({ appId }).pipe(
          Stream.map((fn) => fn.slug),
          Stream.filter((slug): slug is string => slug !== undefined),
          Stream.runCollect,
          Effect.map((slugs) => [...slugs].sort()),
          devServerCredentials(devServer),
        );

      const syncFunctions = Effect.fn(
        function* (devServer: string, appId: string, url: string, expected: string[]) {
          yield* register(appId, url);
          const reported = yield* observeFunctions(devServer, appId);
          return yield* compareFunctions(appId, expected, reported);
        },
        Effect.retry({
          while: (e) => e._tag === "Inngest.AppFunctionsOutOfSync",
          schedule: Schedule.spaced("1 second"),
          times: 10,
        }),
      );

      const unregister = Effect.fn(function* (devServer: string, url: string) {
        const res = yield* client
          .execute(
            HttpClientRequest.delete(`${devServer.replace(/\/$/, "")}/fn/remove`).pipe(
              HttpClientRequest.setUrlParam("url", url),
            ),
          )
          .pipe(
            Effect.map((res) => res.status),
            Effect.catchTag("HttpClientError", (error) =>
              error.reason._tag === "TransportError"
                ? Effect.succeed(404)
                : Effect.fail(new AppRemoveFailed({ devServer, url, message: error.message })),
            ),
          );
        if (res !== 200 && res !== 404) {
          return yield* new AppRemoveFailed({
            devServer,
            url,
            message: `Removing app ${url} returned HTTP ${res}`,
          });
        }
      });

      return {
        stables: ["appId"],
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news) || output === undefined) return undefined;
          if (news.appId !== output.appId) {
            return { action: "replace" } as const;
          }
          return undefined;
        }),
        reconcile: Effect.fn(function* ({ news, bindings }) {
          const { appId, url, environment } = news;
          const devServer = news.devServer ?? DEFAULT_DEV_SERVER;
          const functions = yield* syncFunctions(
            devServer,
            appId,
            url,
            expectedFunctionSlugs(bindings),
          );
          return { appId, url, environment, functions };
        }),
        delete: Effect.fn(function* ({ olds, output }) {
          yield* unregister(olds.devServer ?? DEFAULT_DEV_SERVER, output.url);
        }),
        read: Effect.fn(function* ({ olds, output }) {
          const appId = output?.appId ?? olds.appId;
          const devServer = olds.devServer ?? DEFAULT_DEV_SERVER;
          const observed = yield* Inngest.getV2App({ appId }).pipe(
            devServerCredentials(devServer),
            Effect.map((res) => res.data),
            Effect.catchTag("AppNotFound", () => Effect.succeed(undefined)),
            Effect.catchTag("HttpClientError", transportErrorAsMissing),
          );
          if (observed === undefined) return undefined;
          const functions = yield* observeFunctions(devServer, appId).pipe(
            Effect.catchTag("HttpClientError", transportErrorAsMissing),
          );
          if (functions === undefined) return undefined;
          return {
            appId,
            url: observed.latestSync?.url ?? output?.url ?? olds.url,
            environment: output?.environment ?? olds.environment,
            functions,
          };
        }),
      };
    }),
  );
