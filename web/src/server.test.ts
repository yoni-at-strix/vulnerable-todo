import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import net from "node:net";
import test from "node:test";
import { dirname, join, resolve } from "node:path";

// The export endpoint serves paths relative to the repository root, the same
// base the original resolve() call used.
const repoRoot = resolve(import.meta.dirname, "../..");
const exportFile = join(repoRoot, "data", "todos.json");
const exportContents =
  `${JSON.stringify(
    [{ id: "t1", title: "Exported todo", notes: "", done: false, dueAt: null, createdAt: "2024-01-01T00:00:00.000Z" }],
    null,
    2
  )}\n`;

let server: Server;
let baseUrl: string;
let previousContents: string | null = null;

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });
}

test.before(async () => {
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.TODO_DATA_FILE = exportFile;

  mkdirSync(dirname(exportFile), { recursive: true });
  previousContents = existsSync(exportFile) ? readFileSync(exportFile, "utf8") : null;
  writeFileSync(exportFile, exportContents, "utf8");

  ({ server } = await import("./server.js"));
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  if (previousContents === null) {
    rmSync(exportFile);
  } else {
    writeFileSync(exportFile, previousContents, "utf8");
  }
});

test("serves the default export file", async () => {
  const response = await fetch(`${baseUrl}/api/export`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), exportContents);
});

test("serves an export file requested inside the root", async () => {
  const response = await fetch(`${baseUrl}/api/export?file=${encodeURIComponent("data/todos.json")}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), exportContents);
});

test("rejects absolute paths outside the root", async () => {
  const response = await fetch(`${baseUrl}/api/export?file=${encodeURIComponent("/etc/passwd")}`);
  assert.ok(!response.ok, `expected a failure status, got ${response.status}`);
  const body = await response.text();
  assert.ok(!body.includes("root:x:0:0"), "leaked /etc/passwd contents");
});

test("rejects relative traversal out of the root", async () => {
  const response = await fetch(
    `${baseUrl}/api/export?file=${encodeURIComponent("../../../../etc/passwd")}`
  );
  assert.ok(!response.ok, `expected a failure status, got ${response.status}`);
  const body = await response.text();
  assert.ok(!body.includes("root:x:0:0"), "leaked /etc/passwd contents");
});

test("rejects encoded traversal out of the root", async () => {
  const response = await fetch(
    `${baseUrl}/api/export?file=${encodeURIComponent("..%2f..%2f..%2f..%2fetc%2fpasswd")}`
  );
  assert.ok(!response.ok, `expected a failure status, got ${response.status}`);
});

test("keeps returning 404 for files that do not exist", async () => {
  const response = await fetch(`${baseUrl}/api/export?file=nonexistent-xyz`);
  assert.equal(response.status, 404);
});