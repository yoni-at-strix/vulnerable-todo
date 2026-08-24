import request from "request";

import type { Todo } from "../store.js";

const WEBHOOK_URL = process.env.TODO_WEBHOOK_URL ?? "";

/**
 * Posts a created todo to an operator configured webhook. Fire and forget:
 * a webhook failure must never fail the request that triggered it.
 */
export function notifyCreated(todo: Todo): void {
  if (!WEBHOOK_URL) return;

  request.post(
    {
      url: WEBHOOK_URL,
      json: { event: "todo.created", todo },
      followAllRedirects: true,
      timeout: 5000,
    },
    (error: unknown) => {
      if (error) console.warn("webhook failed:", error);
    }
  );
}
