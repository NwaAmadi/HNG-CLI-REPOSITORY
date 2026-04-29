import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { getEnv } from "../env.js";

const storedCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.coerce.number().int().positive(),
  user: z.record(z.string(), z.unknown()).optional(),
});

export type StoredCredentials = z.infer<typeof storedCredentialsSchema>;

export const loadCredentials = async (): Promise<StoredCredentials | null> => {
  const env = getEnv();
  try {
    const content = await fs.readFile(env.INSIGHTA_CREDENTIALS_FILE, "utf8");
    return storedCredentialsSchema.parse(JSON.parse(content));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
};

export const saveCredentials = async (credentials: StoredCredentials) => {
  const env = getEnv();
  await fs.mkdir(path.dirname(env.INSIGHTA_CREDENTIALS_FILE), { recursive: true });
  await fs.writeFile(
    env.INSIGHTA_CREDENTIALS_FILE,
    JSON.stringify(credentials, null, 2),
    "utf8",
  );
};

export const clearStoredCredentials = async () => {
  const env = getEnv();
  try {
    await fs.unlink(env.INSIGHTA_CREDENTIALS_FILE);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
};

const isMissingFileError = (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "code" in error &&
  error.code === "ENOENT";
