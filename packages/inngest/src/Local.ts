import type * as RpcServer from "alchemy/Local/RpcServer";
import { DevServerProviderLocal } from "./DevServer.ts";

export default DevServerProviderLocal() satisfies RpcServer.ProviderLayer;
