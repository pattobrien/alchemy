import { Inngest } from "inngest";
import { serve } from "inngest/cloudflare";

export const APP_ID = "alchemy-test-sync";

const inngest = new Inngest({ id: APP_ID });

const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "alchemy/test.ping" }] },
  async () => "pong",
);

export default {
  fetch: serve({ client: inngest, functions: [ping] }),
};
