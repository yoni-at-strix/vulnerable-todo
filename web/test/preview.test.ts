import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);

const ROOT = resolve(import.meta.dirname, "../..");
const PORT = 3179;
const BASE = `http://127.0.0.1:${PORT}`;

const dataDir = mkdtempSync(resolve(tmpdir(), "preview-test-"));
const server = spawn(
  process.execPath,
  ["--import", "tsx", resolve(ROOT, "web/src/server.ts")],
  {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), TODO_DATA_FILE: resolve(dataDir, "todos.json") },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.resume();
server.stderr.resume();

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(`${BASE}/api/version`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
}

function postPreview(body: unknown): Promise<Response> {
  return fetch(`${BASE}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(response: Promise<Response>): Promise<{ status: number; body: Record<string, unknown> }> {
  const awaited = await response;
  return { status: awaited.status, body: (await awaited.json()) as Record<string, unknown> };
}

async function assertServerAlive(): Promise<void> {
  assert.equal(server.exitCode, null, `server process exited (exitCode=${server.exitCode})`);
  const { status } = await getJson(fetch(`${BASE}/api/version`));
  assert.equal(status, 200, "server stopped answering after a preview request");
}

after(() => {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("POST /api/preview", () => {
  it("renders a benign template", async () => {
    await waitForServer();
    const { status, body } = await getJson(
      postPreview({ template: "Hello {{name}}", context: { name: "world" } }),
    );
    assert.equal(status, 200);
    assert.equal(body.html, "Hello world");
    await assertServerAlive();
  });

  it("rejects an unknown renderer without affecting the process", async () => {
    const { status, body } = await getJson(postPreview({ renderer: "nope", template: "x" }));
    assert.equal(status, 400);
    assert.equal(body.error, "unknown renderer");
    await assertServerAlive();
  });

  it("answers a syntactically invalid template instead of crashing", async () => {
    const { status, body } = await getJson(postPreview({ template: "{{#if x}}" }));
    assert.equal(status, 400);
    assert.equal(body.error, "template rendering failed");
    await assertServerAlive();
  });

  it("survives a well-formed template with a 15,000 segment dotted path", async () => {
    const template = `{{${"a.".repeat(15000)}a}}`;
    const { status, body } = await getJson(postPreview({ template }));
    assert.ok(
      status === 200 || (status === 400 && body.error === "template rendering failed"),
      `expected a rendered or rejected response, got ${status}`,
    );
    await assertServerAlive();
  });

  it("survives a well-formed template with 2,000 nested blocks", async () => {
    const template = `${"{{#if x}}".repeat(2000)}y${"{{/if}}".repeat(2000)}`;
    const { status, body } = await getJson(postPreview({ template, context: { x: true } }));
    assert.ok(
      status === 200 || (status === 400 && body.error === "template rendering failed"),
      `expected a rendered or rejected response, got ${status}`,
    );
    await assertServerAlive();
  });

  it("still renders deeply structured templates below the recursion threshold", async () => {
    const { status, body } = await getJson(
      postPreview({ template: "{{#if x}}y{{/if}}", context: { x: true } }),
    );
    assert.equal(status, 200);
    assert.equal(body.html, "y");
    await assertServerAlive();
  });
});