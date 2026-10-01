import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname as pathDirname, resolve } from "node:path";

const PORT = Number(process.env.TEST_PORT ?? 3491);
const dataDir = mkdtempSync(`${tmpdir()}/vulnerable-todo-test-`);
const DATA_FILE = resolve(dataDir, "todos.json");

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`ok - ${label}`);
  } else {
    failures += 1;
    console.log(`not ok - ${label}${detail ? `: ${detail}` : ""}`);
  }
}

function fetchRaw(path: string, method: string, body: string): Promise<{ status: number; contentType: string; text: string }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request(
      { host: "127.0.0.1", port: PORT, path, method, headers: { "Content-Type": "application/json" } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => {
          resolveRequest({
            status: res.statusCode ?? 0,
            contentType: String(res.headers["content-type"] ?? ""),
            text,
          });
        });
      },
    );
    req.on("error", rejectRequest);
    req.end(body);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: resolve(pathDirname(fileURLToPath(import.meta.url)), ".."),
  env: { ...process.env, PORT: String(PORT), TODO_DATA_FILE: DATA_FILE },
  stdio: ["ignore", "ignore", "ignore"],
});

let ready = false;
for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
  try {
    const response = await fetchRaw("/api/version", "GET", "");
    ready = response.status === 200;
  } catch {
    await delay(250);
  }
}
check("server started", ready);

try {
  const malformed = await fetchRaw("/api/todos", "POST", "{bad json");
  const leaked = /at JSON\.parse|SyntaxError:|node_modules|\/workspace\/|&lt;br&gt;/.test(malformed.text);
  check(
    "malformed JSON is rejected with status 400",
    malformed.status === 400,
    `status ${malformed.status}`,
  );
  check(
    "malformed JSON response is JSON, not the default HTML error page",
    malformed.contentType.includes("application/json") && !malformed.contentType.includes("text/html"),
    `content type ${malformed.contentType}`,
  );
  check(
    "malformed JSON response contains no stack trace or host paths",
    !leaked,
    `body ${malformed.text.slice(0, 200)}`,
  );

  const created = await fetchRaw("/api/todos", "POST", JSON.stringify({ title: "baseline" }));
  check(
    "valid request still creates a todo",
    created.status === 201 && JSON.parse(created.text).title === "baseline",
    `status ${created.status} body ${created.text.slice(0, 200)}`,
  );

  const unknownRenderer = await fetchRaw(
    "/api/preview",
    "POST",
    JSON.stringify({ renderer: "no-such-renderer" }),
  );
  check(
    "unknown renderer still reports its application-level 400",
    unknownRenderer.status === 400 && unknownRenderer.text.includes("unknown renderer"),
    `status ${unknownRenderer.status} body ${unknownRenderer.text.slice(0, 200)}`,
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => {
      child.once("exit", resolveExit);
    }),
    delay(2000).then(() => {
      child.kill("SIGKILL");
    }),
  ]);
  rmSync(dataDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log("all tests passed");