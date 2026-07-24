import { z } from "zod";

const rowSchema = z.object({
  periodEnd: z.coerce.date(),
  payDate: z.coerce.date(),
});

export const createPayrollCalendarSchema = z.object({
  clientId: z.string(),
  name: z.string().min(1),
  rows: z.array(rowSchema).default([]),
});
export type CreatePayrollCalendarInput = z.infer<typeof createPayrollCalendarSchema>;

// Replaces the whole rows array on PATCH — simplest correct semantics for a small, admin-curated list.
export const updatePayrollCalendarSchema = z.object({
  name: z.string().min(1).optional(),
  rows: z.array(rowSchema).optional(),
});
export type UpdatePayrollCalendarInput = z.infer<typeof updatePayrollCalendarSchema>;

export const listPayrollCalendarsQuerySchema = z.object({
  clientId: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const payrollCalendarIdParamSchema = z.object({ id: z.string() });
