import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { realpathSync } from "node:fs";

import express from "express";

import { apiVersion } from "./lib/version.js";
import { loadRenderer } from "./lib/plugins.js";
import { shareRouter } from "./routes/share.js";
import { todosRouter } from "./routes/todos.js";

const require = createRequire(import.meta.url);
const app = express();
const port = Number(process.env.PORT ?? 3000);

const MAX_JSON_DEPTH = 100;

/**
 * express.json() caps the body size but not how deeply the parsed value can
 * nest. A deeply nested array makes String() recurse past the V8 stack limit
 * inside a handler, and the resulting RangeError kills the whole process, so
 * over-deep payloads are rejected here before any route sees them.
 */
function jsonDepthOk(value: unknown, depth: number): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (Array.isArray(value)) {
    return value.every((item) => jsonDepthOk(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).every((item) => jsonDepthOk(item, depth + 1));
  }
  return true;
}

app.use(express.json());
app.use((req, res, next) => {
  if (req.body !== undefined && !jsonDepthOk(req.body, 0)) {
    res.status(400).json({ error: "request body nested too deeply" });
    return;
  }
  next();
});
app.use(express.static(resolve(import.meta.dirname, "../public")));

// The QR code is drawn in the browser, so the library is served as a plain
// script rather than bundled.
app.use("/vendor", express.static(dirname(require.resolve("qrious/dist/qrious.min.js"))));
app.get("/vendor/qrious.js", (_req, res) => {
  res.sendFile(require.resolve("qrious/dist/qrious.min.js"));
});

app.use("/api/todos", todosRouter);
app.use("/share", shareRouter);

app.get("/api/version", (_req, res) => {
  res.json(apiVersion());
});

app.get("/api/export", (req, res) => {
  const requestedFile = String(req.query.file ?? "data/todos.json");
  res.sendFile(resolve(import.meta.dirname, "../../", requestedFile));
});

app.get("/continue", (req, res) => {
  res.redirect(String(req.query.next ?? "/"));
});

// Optional preview endpoint: renders a note through whichever renderer the
// config file selects.
app.post("/api/preview", async (req, res) => {
  try {
    const rendererName = req.body?.renderer ?? "handlebars";
    const template = req.body?.template ?? "";
    if (typeof rendererName !== "string" || typeof template !== "string") {
      res.status(400).json({ error: "renderer and template must be strings" });
      return;
    }
    const renderer = await loadRenderer(rendererName);
    if (!renderer) {
      res.status(400).json({ error: "unknown renderer" });
      return;
    }
    res.json({ html: renderer(template, req.body?.context ?? {}) });
  } catch {
    res.status(500).json({ error: "preview failed" });
  }
});

export { app };

// Only bind when run as the entry point (npm run dev / npm start), so tests
// can import the app without holding a port or keeping the event loop alive.
if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  app.listen(port, () => {
    console.log(`vulnerable-todo listening on http://localhost:${port}`);
  });
}
