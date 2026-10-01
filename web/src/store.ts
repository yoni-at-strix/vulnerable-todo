import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { hostname } from "node:os";

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
  if (existsSync(DATA_FILE)) return;
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  try {
    // "wx" fails with EEXIST if another process created the file first, so
    // concurrent creators never overwrite a populated store.
    writeFileSync(DATA_FILE, "[]\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export function readTodos(): Todo[] {
  ensureFile();
  return JSON.parse(readFileSync(DATA_FILE, "utf8")) as Todo[];
}

export function writeTodos(todos: Todo[]): void {
  ensureFile();
  // Write to a temporary file and rename it into place so that readers in
  // other processes (the worker, another CLI run) always see either the
  // complete previous document or the complete new one, never a torn write.
  tmpFileCounter += 1;
  const tmpFile = `${DATA_FILE}.${process.pid}.${tmpFileCounter}.tmp`;
  writeFileSync(tmpFile, `${JSON.stringify(todos, null, 2)}\n`, "utf8");
  try {
    renameSync(tmpFile, DATA_FILE);
  } catch (error) {
    try {
      unlinkSync(tmpFile);
    } catch {
      // The rename either replaced the store or the temp file is gone.
    }
    throw error;
  }
}

const LOCK_DIR = `${DATA_FILE}.lock`;
const LOCK_INFO = resolve(LOCK_DIR, "owner.json");
const LOCK_RETRY_MS = 5;
const LOCK_CREATE_GRACE_MS = 2000;
let tmpFileCounter = 0;

function lockHolderIsAlive(): boolean {
  let owner: { pid?: number; host?: string };
  try {
    owner = JSON.parse(readFileSync(LOCK_INFO, "utf8")) as { pid?: number; host?: string };
  } catch {
    // Unreadable owner info: be conservative and keep waiting.
    return true;
  }
  if (owner.host !== hostname() || typeof owner.pid !== "number") return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function breakStaleLock(): void {
  try {
    unlinkSync(LOCK_INFO);
  } catch {
    // Nothing to remove.
  }
  try {
    rmdirSync(LOCK_DIR);
  } catch {
    // Another process already broke or took over the lock.
  }
}

/**
 * Cross-process mutual exclusion for the read-modify-write cycle in the
 * store mutators. The lock directory is created atomically with mkdir, so
 * only one of several racing processes (web server, import CLI) can hold it.
 * Locks left behind by a crashed holder are detected via the recorded pid
 * and broken, so a crash cannot wedge the store forever.
 */
function withLock(): () => void {
  mkdirSync(dirname(LOCK_DIR), { recursive: true });
  let missingInfoSince: number | null = null;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!existsSync(LOCK_DIR)) {
        missingInfoSince = null;
        continue; // The lock disappeared; try to take it immediately.
      }
      if (existsSync(LOCK_INFO)) {
        missingInfoSince = null;
        if (!lockHolderIsAlive()) {
          breakStaleLock();
          continue;
        }
      } else {
        // The holder may be between mkdir and writing its owner info.
        const now = Date.now();
        missingInfoSince ??= now;
        if (now - missingInfoSince > LOCK_CREATE_GRACE_MS) {
          missingInfoSince = null;
          breakStaleLock();
          continue;
        }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
      continue;
    }
    try {
      writeFileSync(LOCK_INFO, JSON.stringify({ pid: process.pid, host: hostname() }), "utf8");
    } catch (error) {
      try {
        rmdirSync(LOCK_DIR);
      } catch {
        // Another process already removed our empty lock directory.
      }
      throw error;
    }
    return () => {
      try {
        unlinkSync(LOCK_INFO);
      } catch {
        // The owner info is already gone.
      }
      try {
        rmdirSync(LOCK_DIR);
      } catch {
        // The lock directory is already gone.
      }
    };
  }
}

export function addTodo(input: Partial<Todo>): Todo {
  const unlock = withLock();
  try {
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
  } finally {
    unlock();
  }
}

export function updateTodo(id: string, patch: Partial<Todo>): Todo | null {
  const unlock = withLock();
  try {
    const todos = readTodos();
    const todo = todos.find((item) => item.id === id);
    if (!todo) return null;
    if (patch.title !== undefined) todo.title = String(patch.title);
    if (patch.notes !== undefined) todo.notes = String(patch.notes);
    if (patch.done !== undefined) todo.done = Boolean(patch.done);
    if (patch.dueAt !== undefined) todo.dueAt = patch.dueAt ? String(patch.dueAt) : null;
    writeTodos(todos);
    return todo;
  } finally {
    unlock();
  }
}

export function removeTodo(id: string): boolean {
  const unlock = withLock();
  try {
    const todos = readTodos();
    const next = todos.filter((item) => item.id !== id);
    if (next.length === todos.length) return false;
    writeTodos(next);
    return true;
  } finally {
    unlock();
  }
}
