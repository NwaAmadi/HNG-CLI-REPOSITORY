import { getEnv } from "../env.js";
import {
  clearStoredCredentials,
  loadCredentials,
  saveCredentials,
  type StoredCredentials,
} from "../auth/credentials.js";
import { normalizeTokenPayload } from "../auth/token-payload.js";
import { ApiError, AuthRequiredError } from "../utils/errors.js";

type RequestOptions = {
  method?: string;
  headers?: HeadersInit;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  auth?: boolean;
  apiVersion?: boolean;
  responseType?: "json" | "text";
  retryOnUnauthorized?: boolean;
};

type ProfileListResult = {
  items: Array<Record<string, unknown>>;
  raw: unknown;
};

class ApiClient {
  private refreshPromise: Promise<StoredCredentials> | null = null;

  async getCurrentUser() {
    const env = getEnv();
    return this.requestJson<Record<string, unknown>>(env.INSIGHTA_ME_PATH);
  }

  async listProfiles(query: Record<string, string | number | undefined>) {
    const env = getEnv();
    return this.extractProfiles(
      await this.requestJson(env.INSIGHTA_PROFILES_PATH, {
        query: mapProfileQuery(query),
        apiVersion: true,
      }),
    );
  }

  async getProfile(id: string) {
    const env = getEnv();
    return this.requestJson<Record<string, unknown>>(
      `${env.INSIGHTA_PROFILES_PATH}/${encodeURIComponent(id)}`,
      { apiVersion: true },
    );
  }

  async searchProfiles(query: string) {
    const env = getEnv();
    try {
      return this.extractProfiles(
        await this.requestJson(env.INSIGHTA_PROFILES_SEARCH_PATH, {
          apiVersion: true,
          query: {
            q: query,
            query,
          },
        }),
      );
    } catch (error) {
      if (!(error instanceof ApiError) || ![404, 405].includes(error.status)) {
        throw error;
      }

      return this.extractProfiles(
        await this.requestJson(env.INSIGHTA_PROFILES_SEARCH_PATH, {
          method: "POST",
          apiVersion: true,
          body: {
            q: query,
            query,
          },
        }),
      );
    }
  }

  async createProfile(input: Record<string, unknown>) {
    const env = getEnv();
    return this.requestJson<Record<string, unknown>>(env.INSIGHTA_PROFILES_PATH, {
      method: "POST",
      apiVersion: true,
      body: input,
    });
  }

  async exportProfiles(query: Record<string, string | number | undefined>) {
    const env = getEnv();
    return this.requestText(env.INSIGHTA_PROFILES_EXPORT_PATH, {
      query: {
        format: query.format,
        ...mapProfileQuery(query),
      },
      apiVersion: true,
    });
  }

  async logout() {
    const env = getEnv();
    const credentials = await loadCredentials();

    if (!credentials?.refreshToken) {
      await clearStoredCredentials();
      return;
    }

    try {
      await this.requestJson(
        env.INSIGHTA_AUTH_LOGOUT_PATH,
        {
          method: "POST",
          auth: false,
          body: {
            refreshToken: credentials.refreshToken,
            refresh_token: credentials.refreshToken,
          },
        },
      );
    } finally {
      await clearStoredCredentials();
    }
  }

  async refreshCredentials() {
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }

    return this.refreshPromise;
  }

  private async performRefresh() {
    const env = getEnv();
    const current = await loadCredentials();

    if (!current?.refreshToken) {
      await clearStoredCredentials();
      throw new AuthRequiredError("Your session expired. Run `insighta login`.");
    }

    try {
      const response = await this.requestJson<Record<string, unknown>>(
        env.INSIGHTA_AUTH_REFRESH_PATH,
        {
          method: "POST",
          auth: false,
          retryOnUnauthorized: false,
          body: {
            refreshToken: current.refreshToken,
            refresh_token: current.refreshToken,
          },
        },
      );

      const next = normalizeTokenPayload(response, current.user);
      await saveCredentials(next);
      return next;
    } catch (error) {
      await clearStoredCredentials();

      if (error instanceof ApiError || error instanceof AuthRequiredError) {
        throw new AuthRequiredError("Your session expired. Run `insighta login`.");
      }

      throw error;
    }
  }

  private async requestJson<T>(pathname: string, options: RequestOptions = {}) {
    return (await this.request(pathname, { ...options, responseType: "json" })) as T;
  }

  private async requestText(pathname: string, options: RequestOptions = {}) {
    return (await this.request(pathname, { ...options, responseType: "text" })) as string;
  }

  private async request(pathname: string, options: RequestOptions = {}) {
    const env = getEnv();
    const method = options.method ?? "GET";
    const headers = new Headers(options.headers);
    const url = new URL(pathname, env.INSIGHTA_API_BASE_URL);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    if (options.apiVersion) {
      headers.set("X-API-Version", String(env.INSIGHTA_API_VERSION));
    }

    let credentials: StoredCredentials | null = null;
    if (options.auth !== false) {
      credentials = await this.ensureAccessToken();
      headers.set("Authorization", `Bearer ${credentials.accessToken}`);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
    });

    if (response.status === 401 && options.auth !== false && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshCredentials();
      headers.set("Authorization", `Bearer ${refreshed.accessToken}`);

      const retryResponse = await fetch(url, {
        method,
        headers,
        body,
      });

      return this.parseResponse(retryResponse, options.responseType ?? "json");
    }

    return this.parseResponse(response, options.responseType ?? "json");
  }

  private async parseResponse(response: Response, responseType: "json" | "text") {
    if (!response.ok) {
      const body = await parseErrorBody(response);
      throw new ApiError(response.status, buildApiErrorMessage(response.status, body), body);
    }

    if (responseType === "text") {
      return response.text();
    }

    if (response.status === 204) {
      return {};
    }

    return response.json();
  }

  private async ensureAccessToken() {
    const credentials = await loadCredentials();

    if (!credentials?.accessToken) {
      throw new AuthRequiredError("You are not logged in. Run `insighta login`.");
    }

    if (Date.now() >= credentials.expiresAt - 15_000) {
      return this.refreshCredentials();
    }

    return credentials;
  }

  private extractProfiles(payload: unknown): ProfileListResult {
    if (Array.isArray(payload)) {
      return { items: payload as Array<Record<string, unknown>>, raw: payload };
    }

    if (payload && typeof payload === "object") {
      const objectPayload = payload as Record<string, unknown>;
      const candidate =
        objectPayload.items ??
        objectPayload.data ??
        objectPayload.results ??
        objectPayload.profiles;

      if (Array.isArray(candidate)) {
        return { items: candidate as Array<Record<string, unknown>>, raw: payload };
      }
    }

    return { items: [], raw: payload };
  }
}

export const getApiClient = () => new ApiClient();

const mapProfileQuery = (query: Record<string, string | number | undefined>) => ({
  gender: query.gender,
  country: query.country,
  country_id: query.country,
  age_group: query.ageGroup,
  min_age: query.minAge,
  max_age: query.maxAge,
  sort_by: query.sortBy,
  order: query.order,
  page: query.page,
  limit: query.limit,
});

const parseErrorBody = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    return await response.text();
  } catch {
    return null;
  }
};

const buildApiErrorMessage = (status: number, body: unknown) => {
  if (typeof body === "string" && body.trim()) {
    return body;
  }

  if (body && typeof body === "object") {
    const objectBody = body as Record<string, unknown>;
    const message =
      objectBody.message ??
      objectBody.error ??
      objectBody.detail ??
      objectBody.title;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  if (status === 403) {
    return "403 Forbidden";
  }

  if (status === 401) {
    return "401 Unauthorized";
  }

  return `Request failed with status ${status}`;
};
