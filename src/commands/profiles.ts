import fs from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { getApiClient } from "../services/api-client.js";
import { ApiError } from "../utils/errors.js";
import { printTable } from "../utils/table.js";

type ProfileListOptions = {
  gender?: string;
  country?: string;
  ageGroup?: string;
  minAge?: number;
  maxAge?: number;
  sortBy?: string;
  order?: string;
  page?: number;
  limit?: number;
};

export const buildProfilesCommands = (program: Command) => {
  const profiles = new Command("profiles").description("Manage profiles");

  profiles
    .command("list")
    .description("List profiles")
    .option("--gender <gender>", "Filter by gender")
    .option("--country <country>", "Filter by country")
    .option("--age-group <ageGroup>", "Filter by age group")
    .option("--min-age <minAge>", "Minimum age", parseInteger)
    .option("--max-age <maxAge>", "Maximum age", parseInteger)
    .option("--sort-by <sortBy>", "Sort field")
    .option("--order <order>", "Sort order")
    .option("--page <page>", "Page number", parseInteger)
    .option("--limit <limit>", "Page size", parseInteger)
    .action(async (options: ProfileListOptions) => {
      console.log("Fetching profiles...");
      const client = getApiClient();
      const result = await client.listProfiles(options);
      printProfileTable(result.items);
    });

  profiles
    .command("get")
    .description("Get a single profile by ID")
    .argument("<id>", "Profile ID")
    .action(async (id: string) => {
      console.log("Fetching profile...");
      const client = getApiClient();
      const profile = await client.getProfile(id);
      printProfileTable([profile]);
    });

  profiles
    .command("search")
    .description("Search profiles in natural language")
    .argument("<query>", "Search query")
    .action(async (query: string) => {
      console.log("Searching profiles...");
      const client = getApiClient();
      const result = await client.searchProfiles(query);
      printProfileTable(result.items);
    });

  profiles
    .command("create")
    .description("Create a profile")
    .requiredOption("--name <name>", "Profile name")
    .option("--age <age>", "Profile age", parseInteger)
    .option("--gender <gender>", "Profile gender")
    .option("--country <country>", "Profile country")
    .action(async (options: Record<string, string | number | undefined>) => {
      console.log("Creating profile...");
      const client = getApiClient();

      try {
        const created = await client.createProfile(options);
        console.log("Profile created successfully");
        printProfileTable([created]);
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          throw new ApiError(403, "403 Forbidden: Admin access required", error.body);
        }

        throw error;
      }
    });

  profiles
    .command("export")
    .description("Export profiles to the current directory")
    .option("--format <format>", "Export format", "csv")
    .action(async (options: { format: string }) => {
      console.log("Exporting profiles...");
      const client = getApiClient();

      if (options.format !== "csv") {
        throw new Error(`Unsupported export format: ${options.format}`);
      }

      const rows = await client.exportProfiles(options.format);
      const filename = `profiles_${new Date().toISOString().slice(0, 10)}.csv`;
      const filePath = path.join(process.cwd(), filename);

      await fs.writeFile(filePath, rows, "utf8");
      console.log(`Export saved to ${filePath}`);
    });

  program.addCommand(profiles);
};

const parseInteger = (value: string) => {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Expected an integer but received: ${value}`);
  }

  return parsed;
};

const printProfileTable = (profiles: Array<Record<string, unknown>>) => {
  if (profiles.length === 0) {
    console.log("No profiles found");
    return;
  }

  printTable(
    profiles.map((profile) => ({
      ID: stringifyCell(profile.id),
      Name: stringifyCell(profile.name ?? profile.fullName ?? profile.displayName),
      Age: stringifyCell(profile.age),
      Gender: stringifyCell(profile.gender),
      Country: stringifyCell(profile.country ?? profile.countryName),
    })),
  );
};

const stringifyCell = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};
