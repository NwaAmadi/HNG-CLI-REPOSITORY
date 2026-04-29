import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const expandHomeDirectory = (value: string) =>
  value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;

const parseDotEnvValue = (value: string) => {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const loadDotEnvFile = () => {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(moduleDirectory, "..", ".env"),
  ];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    const content = fs.readFileSync(candidatePath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      const rawValue = trimmedLine.slice(separatorIndex + 1);
      process.env[key] = parseDotEnvValue(rawValue);
    }

    return;
  }
};

loadDotEnvFile();

const envSchema = {
  INSIGHTA_API_BASE_URL: z.string().url(),
  INSIGHTA_AUTH_START_PATH: z.string().startsWith("/"),
  INSIGHTA_AUTH_EXCHANGE_PATH: z.string().startsWith("/").default("/auth/exchange"),
  INSIGHTA_AUTH_REFRESH_PATH: z.string().startsWith("/").default("/auth/refresh"),
  INSIGHTA_AUTH_LOGOUT_PATH: z.string().startsWith("/").default("/auth/logout"),
  INSIGHTA_ME_PATH: z.string().startsWith("/").default("/me"),
  INSIGHTA_PROFILES_PATH: z.string().startsWith("/").default("/api/profiles"),
  INSIGHTA_PROFILES_SEARCH_PATH: z
    .string()
    .startsWith("/")
    .default("/api/profiles/search"),
  INSIGHTA_PROFILES_EXPORT_PATH: z
    .string()
    .startsWith("/")
    .default("/api/profiles/export"),
  INSIGHTA_API_VERSION: z.coerce.number().int().positive(),
  INSIGHTA_CALLBACK_HOST: z.string().min(1),
  INSIGHTA_CALLBACK_PORT: z.coerce.number().int().min(1024).max(65535),
  INSIGHTA_CREDENTIALS_FILE: z
    .string()
    .min(1)
    .transform(expandHomeDirectory),
};

const createValidatedEnv = () =>
  createEnv({
    server: envSchema,
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });

let cachedEnv: ReturnType<typeof createValidatedEnv> | undefined;

export const getEnv = () => {
  cachedEnv ??= createValidatedEnv();
  return cachedEnv;
};
