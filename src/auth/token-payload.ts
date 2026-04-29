import type { StoredCredentials } from "./credentials.js";

export const normalizeTokenPayload = (
  payload: Record<string, unknown>,
  fallbackUser?: Record<string, unknown>,
): StoredCredentials => {
  const accessToken = getString(
    payload.accessToken,
    payload.access_token,
    payload.token,
  );
  const refreshToken = getString(
    payload.refreshToken,
    payload.refresh_token,
  );

  if (!accessToken || !refreshToken) {
    throw new Error("Backend did not return both access and refresh tokens");
  }

  const expiresAt = resolveExpiresAt(payload);
  const user = readUser(payload) ?? fallbackUser;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    user,
  };
};

const resolveExpiresAt = (payload: Record<string, unknown>) => {
  const rawExpiresAt = getNumber(payload.expiresAt, payload.expires_at);
  if (rawExpiresAt) {
    return rawExpiresAt > 1_000_000_000_000 ? rawExpiresAt : rawExpiresAt * 1000;
  }

  const expiresIn = getNumber(payload.expiresIn, payload.expires_in);
  if (expiresIn) {
    return Date.now() + expiresIn * 1000;
  }

  return Date.now() + 180 * 1000;
};

const readUser = (payload: Record<string, unknown>) => {
  const candidate = payload.user ?? payload.profile ?? payload.me;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
  }

  return undefined;
};

const getString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
};

const getNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
};
