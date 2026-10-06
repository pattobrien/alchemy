import type * as RpcServer from "../Local/RpcServer.ts";
import { DevServerProviderLocal } from "./DevServer.ts";

export default DevServerProviderLocal() satisfies RpcServer.ProviderLayer;
