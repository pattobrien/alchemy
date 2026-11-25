import * as Contributions from "alchemy/Contributions";

export default Contributions.make({
  name: "github",
  auth: Contributions.lazy(
    () => import("./AuthProvider.ts"),
    (module) => module.GitHubAuth,
  ),
  cli: {
    provider: {
      description: "Manage GitHub provider prerequisites",
      load: Contributions.lazy(
        () => import("./Cli.ts"),
        (module) => module.githubCommand,
      ),
    },
  },
});
