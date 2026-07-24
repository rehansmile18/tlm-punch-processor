import { Request, Response } from "express";
import pLimit from "p-limit";
import { asyncHandler } from "../../middleware/errorHandler";
import { assertCanWriteClient } from "../../middleware/tenantScope";
import { env } from "../../config/env";
import { processEmployeePeriod } from "./processing.service";
import { CreateProcessingRunInput } from "./processing.validators";

/**
 * Runs the whole batch synchronously (bounded concurrency via p-limit) and returns every
 * employee's outcome in one response — 207, since a batch of N employees is expected to have
 * partial success (a lock conflict for one employee must never fail the rest). A future iteration
 * could make this fire-and-poll for very large batches; for the batch sizes this engine expects,
 * awaiting the whole thing keeps the API simple and the result immediately actionable.
 */
export const createProcessingRunHandler = asyncHandler(async (req: Request, res: Response) => {
  const { clientId, employeeIds, asOfDate } = req.body as CreateProcessingRunInput;
  assertCanWriteClient(req, clientId);

  const limit = pLimit(env.processingConcurrency);
  const results = await Promise.all(
    employeeIds.map((employeeId) => limit(() => processEmployeePeriod(clientId, employeeId, asOfDate)))
  );

  const summary = {
    completed: results.filter((r) => r.status === "completed").length,
    skippedLocked: results.filter((r) => r.status === "skipped_locked").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  res.status(207).json({
    summary,
    items: employeeIds.map((employeeId, index) => ({ employeeId, ...results[index] })),
  });
});
