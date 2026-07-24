import { z } from "zod";

export const createTaskSchema = z.object({
  clientId: z.string(),
  name: z.string().min(1),
  code: z.string().min(1).nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z.object({
  clientId: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const taskIdParamSchema = z.object({
  id: z.string(),
});
