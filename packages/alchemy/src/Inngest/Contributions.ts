import * as Contributions from "../Contributions.ts";

export default Contributions.make({
  name: "inngest",
  auth: Contributions.lazy(
    () => import("./AuthProvider.ts"),
    (module) => module.InngestAuth,
  ),
});
