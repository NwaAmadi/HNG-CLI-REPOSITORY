import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();

const profiles = [
  { id: "p1", name: "Ade", age: 23, gender: "male", country: "NG", age_group: "young-adult" },
  { id: "p2", name: "Bola", age: 31, gender: "male", country: "NG", age_group: "adult" },
  { id: "p3", name: "Chioma", age: 29, gender: "female", country: "NG", age_group: "adult" },
  { id: "p4", name: "David", age: 41, gender: "male", country: "GH", age_group: "adult" },
];

test("global CLI integration flow", async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "insighta-cli-test-"));
  const installPrefix = path.join(sandbox, "prefix");
  const workDir = path.join(sandbox, "workspace");
  const altDir = path.join(sandbox, "alt");
  const fakeHome = path.join(sandbox, "home");
  let tarballPath;

  await fs.mkdir(installPrefix, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(altDir, { recursive: true });
  await fs.mkdir(fakeHome, { recursive: true });

  const backend = await createMockBackend();

  try {
    const callbackPort = await getFreePort();
    tarballPath = await packCli();
    await installCliGlobally(tarballPath, installPrefix);

    const baseEnv = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${path.join(installPrefix, "bin")}:${process.env.PATH ?? ""}`,
      INSIGHTA_API_BASE_URL: backend.baseUrl,
      INSIGHTA_CALLBACK_PORT: String(callbackPort),
    };

    await runLoginFlow({ cwd: altDir, env: baseEnv });

    const credentialsPath = path.join(fakeHome, ".insighta", "credentials.json");
    const savedCredentials = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
    assert.equal(savedCredentials.user.username, "mock-user");

    let result = await runCli(["whoami"], { cwd: workDir, env: baseEnv });
    assert.match(result.stdout, /Logged in as @mock-user/);

    result = await runCli(["profiles", "list"], { cwd: workDir, env: baseEnv });
    assert.match(result.stdout, /Ade/);
    assert.match(result.stdout, /Bola/);

    result = await runCli(["profiles", "list", "--gender", "male"], { cwd: workDir, env: baseEnv });
    assert.equal(backend.lastProfileQuery.gender, "male");

    result = await runCli(
      ["profiles", "list", "--country", "NG", "--age-group", "adult"],
      { cwd: workDir, env: baseEnv },
    );
    assert.equal(backend.lastProfileQuery.country, "NG");
    assert.equal(backend.lastProfileQuery.age_group, "adult");

    result = await runCli(
      ["profiles", "list", "--min-age", "25", "--max-age", "40"],
      { cwd: workDir, env: baseEnv },
    );
    assert.equal(backend.lastProfileQuery.min_age, "25");
    assert.equal(backend.lastProfileQuery.max_age, "40");

    result = await runCli(
      ["profiles", "list", "--sort-by", "age", "--order", "desc"],
      { cwd: workDir, env: baseEnv },
    );
    assert.equal(backend.lastProfileQuery.sort_by, "age");
    assert.equal(backend.lastProfileQuery.order, "desc");

    result = await runCli(
      ["profiles", "list", "--page", "2", "--limit", "20"],
      { cwd: workDir, env: baseEnv },
    );
    assert.equal(backend.lastProfileQuery.page, "2");
    assert.equal(backend.lastProfileQuery.limit, "20");

    result = await runCli(["profiles", "get", "p2"], { cwd: workDir, env: baseEnv });
    assert.match(result.stdout, /Bola/);

    result = await runCli(
      ["profiles", "search", "young males from nigeria"],
      { cwd: workDir, env: baseEnv },
    );
    assert.match(result.stdout, /Ade/);

    backend.createMode = "success";
    result = await runCli(
      ["profiles", "create", "--name", "Harriet Tubman"],
      { cwd: workDir, env: baseEnv },
    );
    assert.match(result.stdout, /Harriet Tubman/);

    result = await runCli(["profiles", "export", "--format", "csv"], {
      cwd: workDir,
      env: baseEnv,
    });
    assert.match(result.stdout, /Export saved to/);
    let exportPath = await readExportPath(result.stdout);
    let exportContent = await fs.readFile(exportPath, "utf8");
    assert.match(exportContent, /Ade/);

    result = await runCli(
      ["profiles", "export", "--format", "csv", "--gender", "male", "--country", "NG"],
      { cwd: altDir, env: baseEnv },
    );
    assert.equal(backend.lastExportQuery.gender, "male");
    assert.equal(backend.lastExportQuery.country, "NG");
    exportPath = await readExportPath(result.stdout);
    exportContent = await fs.readFile(exportPath, "utf8");
    assert.match(exportContent, /Ade/);
    assert.doesNotMatch(exportContent, /Chioma/);

    const expiredCredentials = {
      ...savedCredentials,
      accessToken: "expired-access",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 60_000,
    };
    await fs.writeFile(credentialsPath, JSON.stringify(expiredCredentials, null, 2), "utf8");

    result = await runCli(["whoami"], { cwd: workDir, env: baseEnv });
    assert.match(result.stdout, /Logged in as @mock-user/);
    assert.ok(backend.refreshCount >= 1);

    backend.createMode = "forbidden";
    result = await runCli(
      ["profiles", "create", "--name", "Harriet Tubman"],
      { cwd: workDir, env: baseEnv, expectFailure: true },
    );
    assert.match(result.stderr, /403 Forbidden: Admin access required/);

    result = await runCli(["logout"], { cwd: workDir, env: baseEnv });
    assert.match(result.stderr, /Logged out successfully/);
    await assert.rejects(fs.readFile(credentialsPath, "utf8"));
  } finally {
    await backend.close();
    if (tarballPath) {
      await fs.rm(tarballPath, { force: true });
    }
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

async function packCli() {
  const raw = execFileSync("npm", ["pack", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const [{ filename }] = JSON.parse(raw);
  return path.join(repoRoot, filename);
}

async function installCliGlobally(tarballPath, prefix) {
  await execFileAsync("npm", ["install", "--global", "--prefix", prefix, tarballPath], {
    cwd: repoRoot,
  });
}

async function runCli(args, { cwd, env, expectFailure = false }) {
  try {
    const result = await execFileAsync("insighta", args, {
      cwd,
      env,
      encoding: "utf8",
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0,
    };
  } catch (error) {
    if (!expectFailure) {
      throw error;
    }

    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      code: error.code ?? 1,
    };
  }
}

async function runLoginFlow({ cwd, env }) {
  await new Promise((resolve, reject) => {
    const child = spawn("insighta", ["login"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let triggered = false;

    const maybeTriggerCallback = async (chunk) => {
      stdout += chunk;
      const match = stdout.match(/If the browser did not open, visit: (\S+)/);
      if (!match || triggered) {
        return;
      }

      triggered = true;

      try {
        const response = await fetch(match[1]);
        await response.text();
      } catch (error) {
        reject(error);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      void maybeTriggerCallback(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`login failed\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }

      if (!/Logged in as @mock-user/.test(stdout)) {
        reject(new Error(`login output missing success message\n${stdout}`));
        return;
      }

      resolve();
    });
  });
}

async function readExportPath(output) {
  const match = output.match(/Export saved to (.+)/);
  assert.ok(match, `missing export path in output: ${output}`);
  return match[1].trim();
}

async function createMockBackend() {
  const issuedCodes = new Map();
  const issuedRefreshTokens = new Set(["refresh-token"]);

  const backend = {
    server: null,
    baseUrl: "",
    createMode: "success",
    refreshCount: 0,
    lastProfileQuery: {},
    lastExportQuery: {},
    close: async () => {
      if (!backend.server) {
        return;
      }

      await new Promise((resolve, reject) => {
        backend.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };

  backend.server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (pathname === "/api/auth/github" && request.method === "GET") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state") ?? "backend-state";
      const code = `code-${issuedCodes.size + 1}`;
      issuedCodes.set(code, true);

      response.statusCode = 302;
      response.setHeader("Location", `${redirectUri}?code=${code}&state=${state}`);
      response.end();
      return;
    }

    if (pathname === "/api/auth/cli/exchange" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (!body.code || !body.code_verifier || !issuedCodes.has(body.code)) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Invalid or expired authorization code" }));
        return;
      }

      issuedCodes.delete(body.code);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(successTokens("access-token", "refresh-token")));
      return;
    }

    if (pathname === "/api/auth/refresh" && request.method === "POST") {
      const body = await readJsonBody(request);
      const token = body.refresh_token ?? body.refreshToken;
      if (!issuedRefreshTokens.has(token)) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Invalid refresh token" }));
        return;
      }

      backend.refreshCount += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(successTokens(`access-token-${backend.refreshCount}`, "refresh-token")));
      return;
    }

    if (pathname === "/api/auth/logout" && request.method === "POST") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (pathname === "/me" && request.method === "GET") {
      if (!hasBearerToken(request)) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Unauthorized" }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "u1", username: "mock-user", role: "analyst" }));
      return;
    }

    if (pathname === "/api/profiles" && request.method === "GET") {
      backend.lastProfileQuery = Object.fromEntries(url.searchParams.entries());
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ items: filterProfiles(url.searchParams) }));
      return;
    }

    if (pathname.startsWith("/api/profiles/") && request.method === "GET") {
      const id = decodeURIComponent(pathname.split("/").pop() ?? "");
      const profile = profiles.find((item) => item.id === id);
      if (!profile) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Profile not found" }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(profile));
      return;
    }

    if (pathname === "/api/profiles/search" && request.method === "POST") {
      const body = await readJsonBody(request);
      const query = String(body.query ?? body.q ?? "").toLowerCase();
      const matches = profiles.filter((profile) => {
        if (query.includes("young") && profile.age > 25) {
          return false;
        }

        if (query.includes("male") && profile.gender !== "male") {
          return false;
        }

        if (query.includes("nigeria") && profile.country !== "NG") {
          return false;
        }

        return true;
      });

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: matches }));
      return;
    }

    if (pathname === "/api/profiles" && request.method === "POST") {
      if (backend.createMode === "forbidden") {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Admin access required" }));
        return;
      }

      const body = await readJsonBody(request);
      const created = {
        id: `p${profiles.length + 1}`,
        name: body.name,
        age: body.age ?? null,
        gender: body.gender ?? null,
        country: body.country ?? null,
      };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(created));
      return;
    }

    if (pathname === "/api/profiles/export" && request.method === "GET") {
      backend.lastExportQuery = Object.fromEntries(url.searchParams.entries());
      const rows = filterProfiles(url.searchParams);
      const csv = toCsv(rows);
      response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
      response.end(csv);
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "Not found" }));
  });

  await new Promise((resolve) => backend.server.listen(0, "127.0.0.1", resolve));
  const address = backend.server.address();
  backend.baseUrl = `http://127.0.0.1:${address.port}`;

  return backend;
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function hasBearerToken(request) {
  const value = request.headers.authorization ?? "";
  return value.startsWith("Bearer ");
}

function filterProfiles(searchParams) {
  let result = [...profiles];
  const gender = searchParams.get("gender");
  const country = searchParams.get("country");
  const ageGroup = searchParams.get("age_group");
  const minAge = searchParams.get("min_age");
  const maxAge = searchParams.get("max_age");
  const sortBy = searchParams.get("sort_by");
  const order = searchParams.get("order");
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? String(result.length));

  if (gender) {
    result = result.filter((profile) => profile.gender === gender);
  }

  if (country) {
    result = result.filter((profile) => profile.country === country);
  }

  if (ageGroup) {
    result = result.filter((profile) => profile.age_group === ageGroup);
  }

  if (minAge) {
    result = result.filter((profile) => profile.age >= Number(minAge));
  }

  if (maxAge) {
    result = result.filter((profile) => profile.age <= Number(maxAge));
  }

  if (sortBy === "age") {
    result.sort((left, right) => left.age - right.age);
    if (order === "desc") {
      result.reverse();
    }
  }

  const start = Math.max(page - 1, 0) * Math.max(limit, 0);
  return result.slice(start, start + limit);
}

function successTokens(accessToken, refreshToken) {
  return {
    status: "success",
    data: {
      user: {
        id: "u1",
        username: "mock-user",
        role: "analyst",
      },
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

function toCsv(rows) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => String(row[header] ?? "")).join(","));
  }

  return `${lines.join("\n")}\n`;
}

async function getFreePort() {
  const server = http.createServer();

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}
