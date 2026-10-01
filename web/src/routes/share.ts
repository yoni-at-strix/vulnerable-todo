import { resolve } from "node:path";

import ejs from "ejs";
import { Router, type Request } from "express";

import { readTodos } from "../store.js";

export const shareRouter = Router();

const SHARE_VIEW = resolve(import.meta.dirname, "../../views/share.ejs");

const HOST_PATTERN = /^[A-Za-z0-9.-]+(?::\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](?::\d{1,5})?$/;

// Percent encode the characters that could terminate or alter the inline
// script block the share URL is rendered into. Legitimate request targets and
// hosts never contain them, so normal share links are unchanged.
function encodeMarkupUnsafe(value: string): string {
  return value.replace(/[<>"'`]/g, (char) => encodeURIComponent(char));
}

/**
 * The share URL is rendered into an inline script on the page, so its host
 * part must never contain markup. The Host header is client controlled and
 * may contain anything, including "</script>", so it is only used when it
 * looks like a plain host[:port] and is percent encoded otherwise.
 */
function buildShareUrl(req: Request): string {
  const host = req.get("host") ?? "";
  const safeHost = HOST_PATTERN.test(host) ? host : encodeMarkupUnsafe(host);
  return `${req.protocol}://${safeHost}${encodeMarkupUnsafe(req.originalUrl)}`;
}

/**
 * Public read only view of the list, rendered server side so it can be opened
 * from a QR code on a phone with no JavaScript bundle.
 *
 * Query parameters are passed straight through as template locals so a link
 * can carry display preferences, for example ?theme=dark&title=Groceries.
 */
shareRouter.get("/", (req, res, next) => {
  const locals = {
    ...req.query,
    todos: readTodos(),
    shareUrl: buildShareUrl(req),
  };

  ejs.renderFile(SHARE_VIEW, locals, (error: Error | null, html?: string) => {
    if (error) {
      next(error);
      return;
    }
    res.type("html").send(html);
  });
});
