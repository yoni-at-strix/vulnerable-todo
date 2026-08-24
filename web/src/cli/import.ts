import { readFileSync } from "node:fs";

import yaml from "js-yaml";

import { addTodo } from "../store.js";

/**
 * Bulk import for operators migrating a list in from another tool.
 *
 *   npm run import -- ./lists/groceries.yaml
 *
 * The file is an operator supplied path on the machine running the command.
 * No HTTP route reaches this code.
 */
function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run import -- <file.yaml>");
    process.exit(1);
  }

  const parsed = yaml.load(readFileSync(path, "utf8")) as { todos?: unknown[] } | null;
  const entries = Array.isArray(parsed?.todos) ? parsed.todos : [];

  let imported = 0;
  for (const entry of entries) {
    if (entry && typeof entry === "object") {
      addTodo(entry as Record<string, unknown>);
      imported += 1;
    }
  }

  console.log(`imported ${imported} todo(s) from ${path}`);
}

main();
