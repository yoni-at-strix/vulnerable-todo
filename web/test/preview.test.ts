import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { deepStrictEqual, equal, ok } from "node:assert";
import test from "node:test";
import { app } from "../src/server.js";

process.env.TODO_DATA_FILE = join(mkdtempSync(join(tmpdir(), "todo-test-")), "todos.json");

const server: Server = app.listen();
await new Promise<void>((resolveListen) => server.once("listening", resolveListen));
const port = (server.address() as { port: number }).port;
const baseUrl = `http://127.0.0.1:${port}`;

function deepArray(levels: number): unknown[] {
  let value: unknown[] = [];
  for (let index = 0; index < levels - 1; index += 1) {
    value = [value];
  }
  return value;
}

async function postPreview(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /api/preview survives deep-nesting payloads", async (t) => {
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  await t.test("renders a valid template", async () => {
    const response = await postPreview({ renderer: "handlebars", template: "ok" });
    equal(response.status, 200);
    deepStrictEqual(await response.json(), { html: "ok" });
  });

  await t.test("rejects an over-deep renderer with 400 instead of crashing", async () => {
    const response = await postPreview({ renderer: deepArray(3200), template: "ok" });
    equal(response.status, 400);
  });

  await t.test("rejects an over-deep template with 400 instead of crashing", async () => {
    const response = await postPreview({ renderer: "handlebars", template: deepArray(3200) });
    equal(response.status, 400);
  });

  await t.test("rejects non-string renderer and template values", async () => {
    const shallowArray = ["nested"];
    for (const body of [
      { renderer: shallowArray, template: "ok" },
      { renderer: "handlebars", template: shallowArray },
      { renderer: 123, template: "ok" },
      { renderer: null, template: 456 },
    ]) {
      const response = await postPreview(body);
      equal(response.status, 400);
      deepStrictEqual(await response.json(), { error: "renderer and template must be strings" });
    }
  });

  await t.test("rejects an unknown renderer", async () => {
    const response = await postPreview({ renderer: "markdown", template: "ok" });
    equal(response.status, 400);
    deepStrictEqual(await response.json(), { error: "unknown renderer" });
  });

  await t.test("defaults renderer and template when omitted", async () => {
    const response = await postPreview({});
    equal(response.status, 200);
  });

  await t.test("the process is still serving requests afterwards", async () => {
    const response = await fetch(`${baseUrl}/api/version`);
    equal(response.status, 200);
    const payload = (await response.json()) as { version: string; valid: boolean };
    equal(payload.valid, true);
    ok(payload.version);
  });
});