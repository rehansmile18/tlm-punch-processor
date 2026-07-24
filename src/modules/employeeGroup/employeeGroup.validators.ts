import { z } from "zod";
import { Types } from "mongoose";

export const createEmployeeGroupSchema = z.object({
  clientId: z.string(),
  name: z.string().min(1),
  payPeriodConfigId: z.string(),
});
export type CreateEmployeeGroupInput = z.infer<typeof createEmployeeGroupSchema>;

// All fields optional — clientId is deliberately not included here, mirroring TLM's
// updateRuleGroupSchema/updatePolicySchema: which client owns a resource never changes on update.
export const updateEmployeeGroupSchema = z.object({
  name: z.string().min(1).optional(),
  payPeriodConfigId: z.string().optional(),
});
export type UpdateEmployeeGroupInput = z.infer<typeof updateEmployeeGroupSchema>;

export const listEmployeeGroupsQuerySchema = z.object({
  clientId: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const employeeGroupIdParamSchema = z.object({
  id: z.string().refine((value) => Types.ObjectId.isValid(value), "Invalid employee group id"),
});
