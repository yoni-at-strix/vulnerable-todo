import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = join(webDir, "src/server.ts");
const tsxCli = resolve(webDir, "../node_modules/tsx/dist/cli.mjs");
const serverSourceBefore = readFileSync(serverEntry, "utf8");

let child: ReturnType<typeof spawn> | undefined;
let childPid: number | undefined;
let tempDataDir: string | undefined;

test.afterEach(() => {
  if (child) {
    try {
      process.kill(-childPid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    child = undefined;
    childPid = undefined;
  }
  if (tempDataDir) {
    rmSync(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
});

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolvePort(port));
    });
    probe.on("error", reject);
  });
}

/**
 * Boots the real server the way the documented `start` script does
 * (`tsx src/server.ts`), against an isolated data file, and waits until it
 * accepts connections.
 */
async function startServer(): Promise<number> {
  const port = await freePort();
  tempDataDir = mkdtempSync(join(tmpdir(), "share-test-"));
  const dataFile = join(tempDataDir, "todos.json");
  child = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: webDir,
    stdio: "ignore",
    detached: true,
    env: { ...process.env, PORT: String(port), TODO_DATA_FILE: dataFile },
  });
  childPid = child.pid;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/share`);
      if (response.ok) {
        response.body?.cancel();
        return port;
      }
    } catch {
      // not listening yet
    }
    await delay(250);
  }
  throw new Error("server did not start within 20s");
}

test("GET /share ignores ejs option-injection query keys and does not execute them", async (t) => {
  const port = await startServer();

  // Same attack shape as the reported chain: settings[view options][outputFunctionName]
  // reaching ejs compile options appends attacker code to the entrypoint source,
  // which executes on the next process start (tsx watch restart or operator restart).
  const marker = join(tmpdir(), `share-rce-${process.pid}.txt`);
  rmSync(marker, { force: true });
  const bootLine = `;import("node:child_process").then(function (c) { c.execSync("touch ${marker}"); });`;
  const js = `import("node:fs").then(function (m) { m.appendFileSync(${JSON.stringify(serverEntry)}, ${JSON.stringify(bootLine)}); });`;
  const payload = `x;${js}var y`;
  // Every ejs option key that compiles attacker text into executed code.
  for (const optionKey of ["outputFunctionName", "escapeFunction", "localsName", "destructuredLocals"]) {
    const query = new URLSearchParams({
      [`settings[view options][${optionKey}]`]: payload,
    });
    const response = await fetch(`http://127.0.0.1:${port}/share?${query}`);
    assert.equal(response.status, 200, `unexpected status for ${optionKey}`);
    await response.text();
  }
  await delay(1000);

  assert.equal(existsSync(marker), false, "RCE marker was created: option injection still executes");
  assert.equal(
    readFileSync(serverEntry, "utf8"),
    serverSourceBefore,
    "server entrypoint source was modified by the share page",
  );

  // Legitimate display preferences still render.
  const page = await fetch(`http://127.0.0.1:${port}/share?theme=dark&title=Groceries`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes("Groceries"));
  assert.match(html, /<body class="dark">/);
});