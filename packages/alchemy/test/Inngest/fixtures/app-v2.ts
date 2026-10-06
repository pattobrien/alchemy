import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "alchemy-test-app" });

const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "alchemy/test.ping" }] },
  async () => "pong",
);

const pong = inngest.createFunction(
  {
    id: "pong",
    triggers: [{ event: "alchemy/test.pong" }],
    concurrency: 2,
    onFailure: async () => {},
  },
  async () => "ping",
);

export const functions = [ping, pong];
