import { inngest } from "./app-v1.ts";

const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "alchemy/test.ping" }], concurrency: 1 },
  async () => "pong",
);

export const functions = [ping];
