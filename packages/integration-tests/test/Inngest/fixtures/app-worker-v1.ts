import { serve } from "inngest/cloudflare";
import { functions, inngest } from "./app-v1.ts";

export default { fetch: serve({ client: inngest, functions }) };
