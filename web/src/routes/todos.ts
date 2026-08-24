import { Router } from "express";

import { notifyCreated } from "../lib/notify.js";
import { addTodo, readTodos, removeTodo, updateTodo } from "../store.js";

export const todosRouter = Router();

todosRouter.get("/", (_req, res) => {
  res.json(readTodos());
});

todosRouter.post("/", (req, res) => {
  const todo = addTodo(req.body ?? {});
  notifyCreated(todo);
  res.status(201).json(todo);
});

todosRouter.patch("/:id", (req, res) => {
  const todo = updateTodo(req.params.id, req.body ?? {});
  if (!todo) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(todo);
});

todosRouter.delete("/:id", (req, res) => {
  if (!removeTodo(req.params.id)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.status(204).end();
});
