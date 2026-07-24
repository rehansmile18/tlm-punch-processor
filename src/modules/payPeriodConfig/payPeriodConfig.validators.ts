import { z } from "zod";
import { CADENCES, PAY_DATE_WEEKEND_RULES } from "../../types/domain";

// Mirrors the Mongoose pre-validate hook on PayPeriodConfig (cadence-specific requirements) as a
// primary validation layer — Zod fails fast with a clean message before Mongoose is ever touched;
// the Mongoose hook stays as defense-in-depth (see errorHandler.ts's ValidationError -> 400 mapping).
function applyCadenceRefinements<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data, ctx) => {
    const value = data as { cadence?: string; weekStartDay?: number | null; anchorDate?: string | null };
    if (!value.cadence) return;
    if ((value.cadence === "weekly" || value.cadence === "biweekly") && value.weekStartDay == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `weekStartDay is required for cadence "${value.cadence}"`, path: ["weekStartDay"] });
    }
    if (value.cadence === "biweekly" && !value.anchorDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'anchorDate is required for cadence "biweekly"', path: ["anchorDate"] });
    }
  });
}

const basePayPeriodConfigFields = {
  clientId: z.string(),
  name: z.string().min(1),
  cadence: z.enum(CADENCES),
  timezone: z.string().min(1),
  weekStartDay: z.number().int().min(0).max(6).nullable().optional(),
  anchorDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "anchorDate must be YYYY-MM-DD")
    .nullable()
    .optional(),
  semiMonthlySplitDay: z.number().int().min(1).max(27).optional(),
  payDateOffsetDays: z.number().int().optional(),
  payDateWeekendRule: z.enum(PAY_DATE_WEEKEND_RULES).optional(),
  payCalendarId: z.string().nullable().optional(),
  // Deliberately no static default here — the service layer defaults this based on cadence
  // (false for "salaried", true otherwise) unless the caller explicitly overrides it.
  producesHourlyLines: z.boolean().optional(),
};

export const createPayPeriodConfigSchema = applyCadenceRefinements(z.object(basePayPeriodConfigFields));
export type CreatePayPeriodConfigInput = z.infer<typeof createPayPeriodConfigSchema>;

// clientId and cadence are excluded from updates — changing cadence out from under an
// already-configured employee/group is a bigger operation than a simple PATCH (would invalidate
// weekStartDay/anchorDate/semiMonthlySplitDay's meaning); create a new config instead.
export const updatePayPeriodConfigSchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  weekStartDay: z.number().int().min(0).max(6).nullable().optional(),
  anchorDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "anchorDate must be YYYY-MM-DD")
    .nullable()
    .optional(),
  semiMonthlySplitDay: z.number().int().min(1).max(27).optional(),
  payDateOffsetDays: z.number().int().optional(),
  payDateWeekendRule: z.enum(PAY_DATE_WEEKEND_RULES).optional(),
  payCalendarId: z.string().nullable().optional(),
  producesHourlyLines: z.boolean().optional(),
});
export type UpdatePayPeriodConfigInput = z.infer<typeof updatePayPeriodConfigSchema>;

export const listPayPeriodConfigsQuerySchema = z.object({
  clientId: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const payPeriodConfigIdParamSchema = z.object({ id: z.string() });
