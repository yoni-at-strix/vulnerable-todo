import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";

import { createServer } from "node:net";

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  return port;
}

test("POST /api/preview with an unparseable template responds instead of crashing the process", async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });

  const started = new URL(`http://localhost:${port}/api/version`);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(started, { signal: AbortSignal.timeout(500) });
      if (response.ok) break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }

  const base = `http://localhost:${port}`;
  const crash = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: "{{7*7}}", context: {} }),
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(crash.ok === false, "bad template must produce an error response, not a hang or crash");
  assert.equal(crash.status, 500);

  const control = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: "{{title}}", context: { title: "ok" } }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(control.status, 200);
  assert.equal((await control.json()).html, "ok");

  const version = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(5000) });
  assert.equal(version.status, 200, "server must keep serving after a bad template request");

  assert.equal(child.exitCode, null, "server process must still be running");
});