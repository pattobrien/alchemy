import * as Contributions from "alchemy/Contributions";

export default Contributions.make({
  name: "namespacelabs",
  auth: Contributions.lazy(
    () => import("./AuthProvider.ts"),
    (module) => module.NamespaceLabsAuth,
  ),
});
