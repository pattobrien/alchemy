import { serve } from "inngest/cloudflare";
import { functions, inngest } from "./app-v2.ts";

export default { fetch: serve({ client: inngest, functions }) };
