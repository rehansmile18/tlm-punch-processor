import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import { createTaskSchema, updateTaskSchema, listTasksQuerySchema, taskIdParamSchema } from "./task.validators";
import { listTasksHandler, getTaskHandler, createTaskHandler, updateTaskHandler } from "./task.controller";

export const taskRouter = Router();
taskRouter.use(authenticate);

taskRouter.get("/tasks", validateRequest({ query: listTasksQuerySchema }), listTasksHandler);
taskRouter.get("/tasks/:id", validateRequest({ params: taskIdParamSchema }), getTaskHandler);
taskRouter.post("/tasks", validateRequest({ body: createTaskSchema }), createTaskHandler);
taskRouter.patch("/tasks/:id", validateRequest({ params: taskIdParamSchema, body: updateTaskSchema }), updateTaskHandler);
