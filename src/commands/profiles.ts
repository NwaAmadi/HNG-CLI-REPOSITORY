import fs from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { getApiClient } from "../services/api-client.js";
import { ApiError } from "../utils/errors.js";
import { withLoader } from "../utils/loading.js";
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

type ProfileExportOptions = ProfileListOptions & {
  format: string;
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
      const client = getApiClient();
      const result = await withLoader(() => client.listProfiles(options), {
        start: "Fetching profiles...",
        success: (response) => `Loaded ${response.items.length} profile(s)`,
      });
      printProfileTable(result.items);
    });

  profiles
    .command("get")
    .description("Get a single profile by ID")
    .argument("<id>", "Profile ID")
    .action(async (id: string) => {
      const client = getApiClient();
      const profile = await withLoader(() => client.getProfile(id), {
        start: `Fetching profile ${id}...`,
        success: "Profile loaded",
      });
      printProfileTable([profile]);
    });

  profiles
    .command("search")
    .description("Search profiles in natural language")
    .argument("<query>", "Search query")
    .action(async (query: string) => {
      const client = getApiClient();
      const result = await withLoader(() => client.searchProfiles(query), {
        start: "Searching profiles...",
        success: (response) => `Found ${response.items.length} profile(s)`,
      });
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
      const client = getApiClient();

      try {
        const created = await withLoader(() => client.createProfile(options), {
          start: "Creating profile...",
          success: "Profile created successfully",
        });
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
    .option("--gender <gender>", "Filter by gender")
    .option("--country <country>", "Filter by country")
    .option("--age-group <ageGroup>", "Filter by age group")
    .option("--min-age <minAge>", "Minimum age", parseInteger)
    .option("--max-age <maxAge>", "Maximum age", parseInteger)
    .option("--sort-by <sortBy>", "Sort field")
    .option("--order <order>", "Sort order")
    .option("--page <page>", "Page number", parseInteger)
    .option("--limit <limit>", "Page size", parseInteger)
    .action(async (options: ProfileExportOptions) => {
      const client = getApiClient();

      if (options.format !== "csv") {
        throw new Error(`Unsupported export format: ${options.format}`);
      }

      const rows = await withLoader(() => client.exportProfiles(options), {
        start: "Exporting profiles...",
        success: "Profiles exported",
      });
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
    profiles.map((profile) => {
      const record = unwrapProfile(profile);

      return {
        ID: stringifyCell(record.id),
        Name: stringifyCell(record.name ?? record.fullName ?? record.displayName),
        Age: stringifyCell(record.age),
        Gender: stringifyCell(record.gender),
        Country: stringifyCell(readCountry(record)),
      };
    }),
  );
};

const unwrapProfile = (profile: Record<string, unknown>) => {
  const candidate =
    profile.data ??
    profile.profile ??
    profile.item ??
    profile.result;

  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
  }

  return profile;
};

const readCountry = (profile: Record<string, unknown>) => {
  const location =
    profile.location && typeof profile.location === "object" && !Array.isArray(profile.location)
      ? (profile.location as Record<string, unknown>)
      : undefined;

  return (
    profile.country ??
    profile.countryName ??
    profile.country_name ??
    profile.countryCode ??
    profile.country_code ??
    profile.nationality ??
    location?.country ??
    location?.countryName ??
    location?.country_name ??
    location?.countryCode ??
    location?.country_code
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
