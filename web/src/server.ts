import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import express from "express";

import { apiVersion } from "./lib/version.js";
import { loadRenderer } from "./lib/plugins.js";
import { shareRouter } from "./routes/share.js";
import { todosRouter } from "./routes/todos.js";

const require = createRequire(import.meta.url);
const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());
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

// Optional preview endpoint: renders a note through whichever renderer the
// config file selects.
app.post("/api/preview", async (req, res) => {
  const renderer = await loadRenderer(String(req.body?.renderer ?? "handlebars"));
  if (!renderer) {
    res.status(400).json({ error: "unknown renderer" });
    return;
  }
  res.json({ html: renderer(String(req.body?.template ?? ""), req.body?.context ?? {}) });
});

app.listen(port, () => {
  console.log(`vulnerable-todo listening on http://localhost:${port}`);
});
