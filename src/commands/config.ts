import type { Command } from "commander";

import { getEnv } from "../env.js";

export const buildConfigCommand = (program: Command) => {
  program
    .command("config")
    .description("Show the validated CLI configuration")
    .action(() => {
      const env = getEnv();
      console.log("Insighta CLI config loaded.");
      console.log(`API base URL: ${env.INSIGHTA_API_BASE_URL}`);
      console.log(`Auth start path: ${env.INSIGHTA_AUTH_START_PATH}`);
      console.log(`Auth exchange path: ${env.INSIGHTA_AUTH_EXCHANGE_PATH}`);
      console.log(`Refresh path: ${env.INSIGHTA_AUTH_REFRESH_PATH}`);
      console.log(`Logout path: ${env.INSIGHTA_AUTH_LOGOUT_PATH}`);
      console.log(`Whoami path: ${env.INSIGHTA_ME_PATH}`);
      console.log(`Profiles path: ${env.INSIGHTA_PROFILES_PATH}`);
      console.log(`Profile search path: ${env.INSIGHTA_PROFILES_SEARCH_PATH}`);
      console.log(`Profile export path: ${env.INSIGHTA_PROFILES_EXPORT_PATH}`);
      console.log(`API version: ${env.INSIGHTA_API_VERSION}`);
      console.log(
        `Callback URL: http://${env.INSIGHTA_CALLBACK_HOST}:${env.INSIGHTA_CALLBACK_PORT}/callback`,
      );
      console.log(`Credentials file: ${env.INSIGHTA_CREDENTIALS_FILE}`);
    });
};
