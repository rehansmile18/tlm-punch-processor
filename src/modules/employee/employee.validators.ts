import { z } from "zod";

export const createEmployeeSchema = z.object({
  clientId: z.string(),
  employeeId: z.string().min(1),
  employeeGroupId: z.string().nullable().optional(),
  timezone: z.string().min(1),
  payPeriodConfigId: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

// clientId is deliberately excluded — an employee never moves between clients, mirroring how
// TLM's updateAssignmentSchema never lets clientId itself be patched.
export const updateEmployeeSchema = z.object({
  employeeId: z.string().min(1).optional(),
  employeeGroupId: z.string().nullable().optional(),
  timezone: z.string().min(1).optional(),
  payPeriodConfigId: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const listEmployeesQuerySchema = z.object({
  clientId: z.string().optional(),
  employeeGroupId: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const employeeIdParamSchema = z.object({
  id: z.string(),
});
