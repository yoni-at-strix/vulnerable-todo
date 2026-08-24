import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import semver from "semver";

interface Todo {
  id: string;
  title: string;
  done: boolean;
  dueAt: string | null;
}

const MIN_SCHEMA = "1.0.0";

/**
 * Prints everything that is past its due date. Run it from cron.
 */
function main(): void {
  const schema = process.env.TODO_SCHEMA_VERSION ?? MIN_SCHEMA;
  if (!semver.valid(schema)) {
    console.error(`TODO_SCHEMA_VERSION is not a valid version: ${schema}`);
    process.exit(1);
  }

  const file =
    process.env.TODO_DATA_FILE ?? resolve(import.meta.dirname, "../../data/todos.json");
  const todos = JSON.parse(readFileSync(file, "utf8")) as Todo[];
  const now = Date.now();

  const overdue = todos.filter(
    (todo) => !todo.done && todo.dueAt !== null && Date.parse(todo.dueAt) < now
  );

  if (overdue.length === 0) {
    console.log("nothing overdue");
    return;
  }

  console.log(`${overdue.length} overdue:`);
  for (const todo of overdue) {
    console.log(`  ${todo.title} (due ${todo.dueAt})`);
  }
}

main();
