import { z } from "zod";

export const listTimesheetsQuerySchema = z.object({
  clientId: z.string().optional(),
  employeeId: z.string().optional(),
  payPeriodId: z.string().optional(),
  status: z.enum(["draft", "completed", "superseded", "voided", "failed"]).optional(),
  includeSuperseded: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTimesheetsQuery = z.infer<typeof listTimesheetsQuerySchema>;

export const timesheetIdParamSchema = z.object({ id: z.string() });

export const voidTimesheetSchema = z.object({ reason: z.string().min(1) });
export type VoidTimesheetInput = z.infer<typeof voidTimesheetSchema>;
