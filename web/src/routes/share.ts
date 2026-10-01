import { resolve } from "node:path";

import ejs from "ejs";
import { Router } from "express";

import { readTodos } from "../store.js";

export const shareRouter = Router();

const SHARE_VIEW = resolve(import.meta.dirname, "../../views/share.ejs");

/**
 * Public read only view of the list, rendered server side so it can be opened
 * from a QR code on a phone with no JavaScript bundle.
 *
 * A few query parameters are allowlisted as template locals so a link can
 * carry display preferences, for example ?theme=dark&title=Groceries. Other
 * keys never reach the template engine, so request input cannot shape ejs
 * compile options.
 */
shareRouter.get("/", (req, res, next) => {
  const theme = req.query.theme === "dark" ? "dark" : undefined;
  const title = typeof req.query.title === "string" ? req.query.title : undefined;
  const locals = {
    title,
    theme,
    todos: readTodos(),
    shareUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
  };

  ejs.renderFile(SHARE_VIEW, locals, (error: Error | null, html?: string) => {
    if (error) {
      next(error);
      return;
    }
    res.type("html").send(html);
  });
});
