import * as Contributions from "alchemy/Contributions";

export default Contributions.make({
  name: "vercel",
  auth: Contributions.lazy(
    () => import("./AuthProvider.ts"),
    (module) => module.VercelAuth,
  ),
});
