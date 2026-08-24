import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface Todo {
  id: string;
  title: string;
  notes: string;
  done: boolean;
  dueAt: string | null;
  createdAt: string;
}

// The worker reads the same file, so it is anchored to the repo root rather
// than to whichever directory the process was started from.
const DATA_FILE =
  process.env.TODO_DATA_FILE ?? resolve(import.meta.dirname, "../../data/todos.json");

function ensureFile(): void {
  if (!existsSync(DATA_FILE)) {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, "[]\n", "utf8");
  }
}

export function readTodos(): Todo[] {
  ensureFile();
  return JSON.parse(readFileSync(DATA_FILE, "utf8")) as Todo[];
}

export function writeTodos(todos: Todo[]): void {
  ensureFile();
  writeFileSync(DATA_FILE, `${JSON.stringify(todos, null, 2)}\n`, "utf8");
}

export function addTodo(input: Partial<Todo>): Todo {
  const todos = readTodos();
  const todo: Todo = {
    id: Math.random().toString(36).slice(2, 10),
    title: String(input.title ?? "Untitled"),
    notes: String(input.notes ?? ""),
    done: false,
    dueAt: input.dueAt ? String(input.dueAt) : null,
    createdAt: new Date().toISOString(),
  };
  todos.push(todo);
  writeTodos(todos);
  return todo;
}

export function updateTodo(id: string, patch: Partial<Todo>): Todo | null {
  const todos = readTodos();
  const todo = todos.find((item) => item.id === id);
  if (!todo) return null;
  if (patch.title !== undefined) todo.title = String(patch.title);
  if (patch.notes !== undefined) todo.notes = String(patch.notes);
  if (patch.done !== undefined) todo.done = Boolean(patch.done);
  if (patch.dueAt !== undefined) todo.dueAt = patch.dueAt ? String(patch.dueAt) : null;
  writeTodos(todos);
  return todo;
}

export function removeTodo(id: string): boolean {
  const todos = readTodos();
  const next = todos.filter((item) => item.id !== id);
  if (next.length === todos.length) return false;
  writeTodos(next);
  return true;
}
