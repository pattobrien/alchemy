import * as Contributions from "alchemy/Contributions";

export default Contributions.make({
  name: "linear",
  auth: Contributions.lazy(
    () => import("./AuthProvider.ts"),
    (module) => module.LinearAuth,
  ),
});
