import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression test for server-side template injection in POST /api/preview
 * (Handlebars 4.0.11). The endpoint used to pass the attacker-controlled
 * `template` field straight to Handlebars.compile(), which allowed an
 * unauthenticated caller to walk object constructors and run arbitrary
 * JavaScript on the server.
 *
 * The test starts the real server (the actual security fix is exercised end
 * to end; nothing is mocked) and replays the original proof-of-concept
 * template that escapes the Handlebars 4.0.11 sandbox and evaluates the
 * `context.p` string as the body of a Function constructor call.
 */

const PORT = 3865;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Handlebars 4.0.11 sandbox-escape template from the original finding. `p`
// becomes the body of a function created via the Function constructor and
// is executed on the server if the input is compiled as template source.
const ESCAPE_TEMPLATE =
  "{{#with p}}" +
  '{{#with this.split as |parr|}}' +
  '{{#with "s" as |string|}}' +
  "{{#with string.split}}" +
  "{{this.pop}}" +
  '{{this.push (lookup string.sub "constructor")}}' +
  "{{this.pop}}" +
  "{{#each this}}" +
  "{{#with (string.sub.constructor.apply 0 parr)}}{{this}}{{/with}}" +
  "{{/each}}" +
  "{{/with}}" +
  "{{/with}}" +
  "{{/with}}" +
  "{{/with}}";

// Unique marker paths; only this test writes them.
const MARKER_DIR = mkdtempSync(join(tmpdir(), "todo-preview-test-"));
const MARKER_FILE = join(MARKER_DIR, "rce-marker.txt");
const MARKER_DATA_FILE = join(MARKER_DIR, "todos.json");

// Marker value with high entropy so a coincidence is not possible.
const MARKER_VALUE = "RCE-MARKER-9d3b1c72f4a5";

function postPreview(body: unknown): Promise<{ status: number; body: string }> {
  return fetch(`${BASE_URL}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => ({
    status: response.status,
    body: await response.text(),
  }));
}

function waitForServer(deadlineMs = 20000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  return new Promise((resolvePromise, reject) => {
    const poll = async () => {
      if (Date.now() > deadline) {
        reject(new Error("server did not start in time"));
        return;
      }
      try {
        const response = await fetch(`${BASE_URL}/api/version`);
        if (response.ok) {
          resolvePromise();
          return;
        }
      } catch {
        // not up yet
      }
      setTimeout(poll, 250).unref();
    };
    poll();
  });
}

describe("POST /api/preview", () => {
  let serverProcess: ReturnType<typeof spawn> | null = null;

  beforeAll(async () => {
    serverProcess = spawn(
      process.execPath,
      ["--import", "tsx", new URL("../src/server.ts", import.meta.url).pathname],
      {
        env: {
          ...process.env,
          PORT: String(PORT),
          TODO_DATA_FILE: MARKER_DATA_FILE,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await waitForServer();
  }, 30000);

  afterAll(async () => {
    serverProcess?.kill("SIGTERM");
    await new Promise((resolvePromise) => {
      if (serverProcess?.exitCode !== null) {
        resolvePromise(undefined);
        return;
      }
      serverProcess?.once("exit", () => resolvePromise(undefined));
      setTimeout(() => {
        serverProcess?.kill("SIGKILL");
        resolvePromise(undefined);
      }, 5000).unref();
    });
    rmSync(MARKER_DIR, { recursive: true, force: true });
  });

  it("renders plain text as inert data, not as template source", async () => {
    const { status, body } = await postPreview({
      template: "<h1>{{title}}</h1>",
      context: { title: "hello" },
    });
    expect(status).toBe(200);
    const parsed = JSON.parse(body) as { html: string };
    // The submitted note text appears literally, so handlebars syntax in
    // the note is displayed rather than evaluated.
    expect(parsed.html).toContain("&lt;h1&gt;{{title}}&lt;/h1&gt;");
  });

  it("does not execute attacker-supplied JavaScript in the note template", async () => {
    const { status, body } = await postPreview({
      template: ESCAPE_TEMPLATE,
      context: { p: "return 41+1" },
    });
    expect(status).toBe(200);
    const parsed = JSON.parse(body) as { html: string };
    expect(parsed.html).not.toContain("42");
  });

  it("cannot write files through the preview endpoint", async () => {
    const { status } = await postPreview({
      template: ESCAPE_TEMPLATE,
      context: {
        p: `return process.getBuiltinModule('fs').writeFileSync('${MARKER_FILE}','${MARKER_VALUE}')`,
      },
    });
    expect(status).toBe(200);
    expect(existsSync(MARKER_FILE)).toBe(false);
  });

  it("rejects unknown renderers", async () => {
    const { status } = await postPreview({
      renderer: "unknown-renderer",
      template: "hello",
    });
    expect(status).toBe(400);
  });
});