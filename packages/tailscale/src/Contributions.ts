import * as Contributions from "alchemy/Contributions";

export default Contributions.make({
  name: "tailscale",
  auth: Contributions.lazy(
    () => import("./AuthProvider.ts"),
    (module) => module.TailscaleAuth,
  ),
});
