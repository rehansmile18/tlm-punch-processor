import { z } from "zod";

const punchFields = {
  clientId: z.string(),
  employeeId: z.string().min(1),
  siteId: z.string().min(1),
  task: z.string().min(1),
  clockIn: z.coerce.date(),
  clockOut: z.coerce.date().nullable().optional(),
  timezone: z.string().min(1),
};

function refineClockOutAfterClockIn<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data, ctx) => {
    const value = data as { clockIn?: Date; clockOut?: Date | null };
    if (value.clockOut && value.clockIn && value.clockOut.getTime() <= value.clockIn.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "clockOut must be after clockIn", path: ["clockOut"] });
    }
  });
}

export const createPunchSchema = refineClockOutAfterClockIn(z.object(punchFields));
export type CreatePunchInput = z.infer<typeof createPunchSchema>;

export const bulkCreatePunchSchema = z.object({
  punches: z.array(z.object(punchFields)).min(1).max(1000),
});
export type BulkCreatePunchInput = z.infer<typeof bulkCreatePunchSchema>;

// Corrections replace clockIn/clockOut/task/siteId/timezone — employeeId and clientId cannot
// change (a correction to a different employee/client is a new punch, not a correction).
export const correctPunchSchema = refineClockOutAfterClockIn(
  z.object({
    siteId: z.string().min(1).optional(),
    task: z.string().min(1).optional(),
    clockIn: z.coerce.date().optional(),
    clockOut: z.coerce.date().nullable().optional(),
    timezone: z.string().min(1).optional(),
  })
);
export type CorrectPunchInput = z.infer<typeof correctPunchSchema>;

export const listPunchesQuerySchema = z.object({
  clientId: z.string().optional(),
  employeeId: z.string().optional(),
  siteId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const punchIdParamSchema = z.object({ id: z.string() });
