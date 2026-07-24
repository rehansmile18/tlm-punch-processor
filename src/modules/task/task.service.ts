import { Types } from "mongoose";
import { Task, TaskDoc } from "../../models/task.model";
import { NotFoundError } from "../../utils/errors";
import { CreateTaskInput, UpdateTaskInput } from "./task.validators";

export async function listTasks(tenantFilter: Record<string, unknown>, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    Task.find(tenantFilter)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Task.countDocuments(tenantFilter),
  ]);
  return { items, total, page, pageSize };
}

export async function getTask(id: string, tenantFilter: Record<string, unknown>) {
  const doc = await Task.findOne({ _id: id, ...tenantFilter }).lean();
  if (!doc) throw new NotFoundError(`Task ${id} not found`);
  return doc;
}

export async function createTask(input: CreateTaskInput): Promise<TaskDoc> {
  const doc = await Task.create({
    clientId: new Types.ObjectId(input.clientId),
    name: input.name,
    code: input.code ?? null,
  });
  return doc;
}

export async function updateTask(id: string, input: UpdateTaskInput, tenantFilter: Record<string, unknown>): Promise<TaskDoc> {
  const doc = await Task.findOne({ _id: id, ...tenantFilter });
  if (!doc) throw new NotFoundError(`Task ${id} not found`);
  if (input.name !== undefined) doc.name = input.name;
  if (input.code !== undefined) doc.code = input.code;
  doc.updatedAt = new Date();
  await doc.save();
  return doc;
}
