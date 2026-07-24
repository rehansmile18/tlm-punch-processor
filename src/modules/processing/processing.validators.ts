import { z } from "zod";

export const createProcessingRunSchema = z.object({
  clientId: z.string(),
  employeeIds: z.array(z.string().min(1)).min(1).max(1000),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "asOfDate must be YYYY-MM-DD"),
});
export type CreateProcessingRunInput = z.infer<typeof createProcessingRunSchema>;
