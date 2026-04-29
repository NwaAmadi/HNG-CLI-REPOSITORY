import crypto from "node:crypto";
import http from "node:http";

import { getEnv } from "../env.js";
import { saveCredentials } from "../auth/credentials.js";
import { normalizeTokenPayload } from "../auth/token-payload.js";
import { getApiClient } from "./api-client.js";
import { openBrowser } from "../utils/browser.js";

type OAuthCallbackResult = {
  code: string;
  state?: string;
};

export const loginWithBrowserFlow = async () => {
  const env = getEnv();
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const redirectUri = getRedirectUri();

  const callbackPromise = waitForOAuthCallback(state);
  const authUrl = new URL(env.INSIGHTA_AUTH_START_PATH, env.INSIGHTA_API_BASE_URL);
  authUrl.searchParams.set("client", "cli");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("redirect_uri", redirectUri);

  console.log("Opening browser for GitHub login...");
  await openBrowser(authUrl.toString());
  console.log(`If the browser did not open, visit: ${authUrl.toString()}`);

  const callback = await callbackPromise;
  const response = await fetch(new URL(env.INSIGHTA_AUTH_EXCHANGE_PATH, env.INSIGHTA_API_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: callback.code,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    let message = `Login failed with status ${response.status}`;

    try {
      const body = (await response.json()) as Record<string, unknown>;
      const candidate = body.message ?? body.error ?? body.detail;
      if (typeof candidate === "string" && candidate.trim()) {
        message = candidate;
      }
    } catch {
      // Ignore parse failures and keep the generic message.
    }

    throw new Error(message);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const credentials = normalizeTokenPayload(payload);
  await saveCredentials(credentials);

  const username =
    credentials.user?.username ??
    credentials.user?.login ??
    credentials.user?.handle ??
    credentials.user?.email;

  console.log(
    username
      ? `Logged in as @${String(username).replace(/^@/, "")}`
      : "Logged in successfully",
  );
};

export const logoutUser = async () => {
  const client = getApiClient();
  await client.logout();
};

const getRedirectUri = () => {
  const env = getEnv();
  return `http://${env.INSIGHTA_CALLBACK_HOST}:${env.INSIGHTA_CALLBACK_PORT}/callback`;
};

const waitForOAuthCallback = async (expectedState: string): Promise<OAuthCallbackResult> =>
  new Promise((resolve, reject) => {
    const env = getEnv();
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", getRedirectUri());

      if (requestUrl.pathname !== "/callback") {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const returnedState = requestUrl.searchParams.get("state");
      const authError = requestUrl.searchParams.get("error");

      if (authError) {
        response.statusCode = 400;
        response.end("Authentication failed. You can close this window.");
        cleanup();
        reject(new Error(`Authentication failed: ${authError}`));
        return;
      }

      if (!code) {
        response.statusCode = 400;
        response.end("Missing OAuth callback code. You can close this window.");
        cleanup();
        reject(new Error("Missing OAuth callback code"));
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("Authentication complete. You can return to the CLI.");
      cleanup();
      if (returnedState && returnedState !== expectedState) {
        console.warn("Warning: OAuth state mismatch from backend callback; continuing with PKCE exchange.");
      }
      resolve({ code, state: returnedState ?? undefined });
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the OAuth callback"));
    }, 5 * 60 * 1000);

    server.on("error", (error) => {
      cleanup();
      reject(error);
    });

    server.listen(env.INSIGHTA_CALLBACK_PORT, env.INSIGHTA_CALLBACK_HOST);

    const cleanup = () => {
      clearTimeout(timeout);
      server.close();
    };
  });

const randomBase64Url = (bytes: number) => crypto.randomBytes(bytes).toString("base64url");
