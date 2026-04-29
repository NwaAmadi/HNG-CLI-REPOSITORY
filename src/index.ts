#!/usr/bin/env node

import { Command } from "commander";

import { buildAuthCommands } from "./commands/auth.js";
import { buildConfigCommand } from "./commands/config.js";
import { buildProfilesCommands } from "./commands/profiles.js";
import { formatCliError } from "./utils/errors.js";

const program = new Command();

program
  .name("insighta")
  .description("CLI for Insighta Labs+")
  .version("1.0.0");

buildConfigCommand(program);
buildAuthCommands(program);
buildProfilesCommands(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(formatCliError(error));
  process.exitCode = 1;
}
