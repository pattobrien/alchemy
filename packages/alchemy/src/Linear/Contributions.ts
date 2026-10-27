import * as Contributions from "../Contributions.ts";

export default Contributions.make({
  name: "linear",
  cli: {
    provider: {
      description: "Manage Linear provider prerequisites",
      load: Contributions.lazy(
        () => import("./Cli.ts"),
        (module) => module.linearCommand,
      ),
    },
  },
});
