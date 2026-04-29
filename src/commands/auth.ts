import type { Command } from "commander";

import { getApiClient } from "../services/api-client.js";
import { loginWithBrowserFlow, logoutUser } from "../services/auth-service.js";
import { printJson } from "../utils/output.js";

export const buildAuthCommands = (program: Command) => {
  program
    .command("login")
    .description("Authenticate with Insighta Labs+ via GitHub OAuth")
    .action(async () => {
      await loginWithBrowserFlow();
    });

  program
    .command("logout")
    .description("Clear local credentials and invalidate the refresh token")
    .action(async () => {
      await logoutUser();
      console.log("Logged out successfully");
    });

  program
    .command("whoami")
    .description("Show the current authenticated user")
    .action(async () => {
      console.log("Fetching current user...");
      const client = getApiClient();
      const user = await client.getCurrentUser();
      const username =
        user.username ?? user.login ?? user.handle ?? user.email ?? user.id;

      if (username) {
        console.log(`Logged in as @${String(username).replace(/^@/, "")}`);
        return;
      }

      printJson(user);
    });
};
