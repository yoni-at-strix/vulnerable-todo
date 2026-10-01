import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, beforeEach, describe, it } from "node:test";

import request from "request";

const root = resolve(import.meta.dirname, "..", "..");
const dataFile = join(root, "data", "todos.json");
const node = process.execPath;

function requestGet(url: string): Promise<unknown[]> {
  return new Promise((resolvePromise, reject) => {
    request(url, { json: true, timeout: 30000, agent: false }, (error, response, body) => {
      if (error) return reject(error);
      if (response.statusCode !== 200) {
        return reject(new Error(`GET ${url} -> ${response.statusCode}: ${JSON.stringify(body)}`));
      }
      resolvePromise(body as unknown[]);
    });
  });
}

function requestPost(url: string, payload: unknown): Promise<{ id: string }> {
  return new Promise((resolvePromise, reject) => {
    request.post(
      url,
      { json: true, body: payload, timeout: 30000, agent: false },
      (error, response, body) => {
        if (error) return reject(error);
        if (response.statusCode !== 201) {
          return reject(new Error(`POST ${url} -> ${response.statusCode}: ${JSON.stringify(body)}`));
        }
        resolvePromise(body as { id: string });
      },
    );
  });
}

async function startServer(port: number): Promise<{ url: string; stop: () => Promise<void> }> {
  const child = spawn(node, ["--import", "tsx", "src/server.ts"], {
    cwd: join(root, "web"),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await requestGet(`${url}/api/todos`);
        break;
      } catch {
        await delay(100);
      }
    }
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return { url, stop: () => stopServer(child) };
}

function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("exit", () => resolvePromise());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000).unref();
  });
}

function runImport(importFile: string): void {
  execFileSync(node, ["--import", "tsx", "src/cli/import.ts", importFile], {
    cwd: join(root, "web"),
    env: { ...process.env, TODO_DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function spawnImport(importFile: string): ReturnType<typeof spawn> {
  return spawn(node, ["--import", "tsx", "src/cli/import.ts", importFile], {
    cwd: join(root, "web"),
    env: { ...process.env, TODO_DATA_FILE: dataFile },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function runOverdueWorker(): string {
  return execFileSync(node, ["--import", "tsx", "src/overdue.ts"], {
    cwd: join(root, "worker"),
    env: { ...process.env, TODO_DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

describe("store cross-process safety", () => {
  let originalDataFile: string | undefined;
  let testDir: string;

  before(() => {
    originalDataFile = process.env.TODO_DATA_FILE;
    testDir = mkdtempSync(join(tmpdir(), "todo-store-race-"));
    process.env.TODO_DATA_FILE = dataFile;
  });

  after(() => {
    if (originalDataFile === undefined) {
      delete process.env.TODO_DATA_FILE;
    } else {
      process.env.TODO_DATA_FILE = originalDataFile;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(join(root, "data"), { recursive: true, force: true });
  });

  it("resolves the data file from TODO_DATA_FILE, not the process cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todo-store-isolation-"));
    const previous = process.env.TODO_DATA_FILE;
    process.env.TODO_DATA_FILE = join(dir, "todos.json");
    try {
      const server = await startServer(3971);
      try {
        const todo = await requestPost(`${server.url}/api/todos`, { title: "isolation check" });
        const stored = JSON.parse(readFileSync(join(dir, "todos.json"), "utf8")) as {
          id: string;
        }[];
        assert.equal(stored.length, 1);
        assert.equal(stored[0].id, todo.id);
      } finally {
        await server.stop();
      }
      assert.ok(existsSync(join(dir, "todos.json")));
      assert.equal(existsSync(join(dir, "data")), false);
    } finally {
      process.env.TODO_DATA_FILE = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recovers when the previous lock holder crashed without unlocking", async () => {
    const server = await startServer(3972);
    try {
      const todo = await requestPost(`${server.url}/api/todos`, { title: "before crash" });
      const lockDir = `${dataFile}.lock`;
      mkdirSync(lockDir);
      writeFileSync(
        join(lockDir, "owner.json"),
        JSON.stringify({ pid: 2147483646, host: hostname() }),
        "utf8",
      );
      try {
        const patched = await new Promise<unknown>((resolvePromise, reject) => {
          const req = request.patch(
            `${server.url}/api/todos/${todo.id}`,
            { json: true, body: { done: true }, timeout: 30000, agent: false },
            (error, response, body) => {
              if (error) return reject(error);
              if (response.statusCode !== 200) {
                return reject(new Error(`PATCH -> ${response.statusCode}: ${JSON.stringify(body)}`));
              }
              resolvePromise(body);
            },
          );
          void req;
        });
        assert.equal((patched as { done: boolean }).done, true);
        assert.equal(existsSync(lockDir), false);
      } finally {
        rmSync(lockDir, { recursive: true, force: true });
      }
    } finally {
      await server.stop();
    }
  });

  it("loses no records when the import CLI races concurrent web writes", async () => {
    const server = await startServer(3973);
    try {
      const importFile = join(testDir, "race-import.yaml");
      const lines = ["todos:"];
      for (let index = 0; index < 400; index += 1) {
        lines.push(`  - title: "race-${index}"`);
      }
      writeFileSync(importFile, `${lines.join("\n")}\n`, "utf8");

      const importChild = spawnImport(importFile);
      const acknowledged = new Set<string>();
      const hammer = (async () => {
        let writer = 0;
        // Keep web writes in flight for the whole import, the way real
        // traffic would be while an operator runs the bulk import.
        while (importChild.exitCode === null) {
          const todo = await requestPost(`${server.url}/api/todos`, {
            title: `web-${writer}`,
          });
          acknowledged.add(todo.id);
          writer += 1;
        }
        if (importChild.exitCode !== 0) {
          assert.fail(`import CLI exited with code ${importChild.exitCode}`);
        }
      })();

      await new Promise<void>((resolvePromise, reject) => {
        importChild.on("error", reject);
        importChild.on("exit", () => resolvePromise());
      });
      await hammer;

      const todos = await requestGet(`${server.url}/api/todos`);
      const imported = todos.filter((todo) =>
        String((todo as { title: string }).title).startsWith("race-"),
      );
      // Before the lock, races discarded most of the imported records
      // (observed: 27, 4, and 0 of 400 persisted).
      assert.equal(imported.length, 400);

      const ids = new Set(todos.map((todo) => (todo as { id: string }).id));
      for (const id of acknowledged) {
        assert.ok(ids.has(id), `HTTP-201-acknowledged todo ${id} was silently lost`);
      }
      assert.equal(todos.length, 400 + acknowledged.size);

      // The store stays a single readable document for the worker, which is
      // a separate process reading the file without any locking.
      const parsed = JSON.parse(readFileSync(dataFile, "utf8")) as unknown[];
      assert.equal(parsed.length, todos.length);
      const dataEntries = readdirSync(join(root, "data"));
      assert.deepEqual(dataEntries.sort(), ["todos.json"]);
      for (let run = 0; run < 10; run += 1) {
        assert.ok(runOverdueWorker().includes("nothing overdue"));
      }
    } finally {
      await server.stop();
    }
  });

  it("loses no records when two import CLI runs race each other", async () => {
    const importFile = join(testDir, "import-a.yaml");
    const otherImportFile = join(testDir, "import-b.yaml");
    for (const [file, prefix] of [
      [importFile, "import-a"],
      [otherImportFile, "import-b"],
    ] as const) {
      const lines = ["todos:"];
      for (let index = 0; index < 200; index += 1) {
        lines.push(`  - title: "${prefix}-${index}"`);
      }
      writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
    }

    const first = spawnImport(importFile);
    const second = spawnImport(otherImportFile);
    const exitCodes = await Promise.all(
      [first, second].map(
        (child) =>
          new Promise<number>((resolvePromise, reject) => {
            child.on("error", reject);
            child.on("exit", (code) => resolvePromise(code ?? -1));
          }),
      ),
    );
    assert.deepEqual(exitCodes, [0, 0]);

    const todos = JSON.parse(readFileSync(dataFile, "utf8")) as { title: string }[];
    const keptA = todos.filter((todo) => todo.title.startsWith("import-a"));
    const keptB = todos.filter((todo) => todo.title.startsWith("import-b"));
    // Two concurrent read-modify-write loops over one file silently dropped
    // hundreds of records before the cross-process lock existed.
    assert.equal(keptA.length, 200);
    assert.equal(keptB.length, 200);
    assert.equal(todos.length, 400);
  });
});