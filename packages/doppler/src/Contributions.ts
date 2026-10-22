import * as Contributions from "alchemy/Contributions";

export default Contributions.make({
  name: "doppler",
  auth: Contributions.lazy(
    () => import("./AuthProvider.ts"),
    (module) => module.DopplerAuth,
  ),
  cli: {
    provider: {
      description: "Manage Doppler provider prerequisites",
      load: Contributions.lazy(
        () => import("./Cli.ts"),
        (module) => module.dopplerCommand,
      ),
    },
  },
});
