import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { getReadClientFilter, assertCanWriteClient } from "../../middleware/tenantScope";
import * as taskService from "./task.service";
import { CreateTaskInput, UpdateTaskInput } from "./task.validators";

export const listTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const result = await taskService.listTasks(getReadClientFilter(req), page, pageSize);
  res.json(result);
});

export const getTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const doc = await taskService.getTask(req.params.id, getReadClientFilter(req));
  res.json(doc);
});

export const createTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateTaskInput;
  assertCanWriteClient(req, input.clientId);
  const doc = await taskService.createTask(input);
  res.status(201).json(doc);
});

export const updateTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const existing = await taskService.getTask(req.params.id, getReadClientFilter(req));
  assertCanWriteClient(req, String(existing.clientId));
  const doc = await taskService.updateTask(req.params.id, req.body as UpdateTaskInput, getReadClientFilter(req));
  res.json(doc);
});
