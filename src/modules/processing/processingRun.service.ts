import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { ProcessingRun, ProcessingRunDoc, ResolvedLayerSummary } from "../../models/processingRun.model";
import { ProcessingState } from "../../engine/types";
import { NotFoundError } from "../../utils/errors";

export interface CreateProcessingRunInput {
  clientId: string;
  employeeId: string;
  businessDate: string;
  timezone: string;
  punchIds: string[];
  engineVersion: string;
}

/** Starts a new ProcessingRun in the "processing" lifecycle state, with a fresh runId. */
export async function createProcessingRun(input: CreateProcessingRunInput): Promise<ProcessingRunDoc> {
  const doc = await ProcessingRun.create({
    runId: randomUUID(),
    clientId: new Types.ObjectId(input.clientId),
    employeeId: input.employeeId,
    businessDate: input.businessDate,
    timezone: input.timezone,
    punchIds: input.punchIds.map((id) => new Types.ObjectId(id)),
    engineVersion: input.engineVersion,
    runStatus: "processing",
    status: "ok",
    startedAt: new Date(),
  });
  return doc;
}

export interface CompleteProcessingRunResult {
  resolvedLayers: ResolvedLayerSummary[];
  unresolvedLevels: string[];
  unresolvedRefs: { targetType: string; ref: unknown }[];
  finalState: ProcessingState;
  flags: string[];
}

/**
 * Marks a run completed and records the pipeline's outcome. `status` is derived from whether
 * anything was left unresolved — "needs_review" if so, "ok" otherwise — never "error" here (that's
 * reserved for failProcessingRun).
 */
export async function completeProcessingRun(runId: string, result: CompleteProcessingRunResult): Promise<ProcessingRunDoc> {
  const status = result.unresolvedRefs.length > 0 || result.unresolvedLevels.length > 0 ? "needs_review" : "ok";
  const doc = await ProcessingRun.findOneAndUpdate(
    { runId },
    {
      $set: {
        finalState: result.finalState,
        resolvedLayers: result.resolvedLayers,
        unresolvedLevels: result.unresolvedLevels,
        unresolvedRefs: result.unresolvedRefs,
        flags: result.flags,
        completedAt: new Date(),
        runStatus: "completed",
        status,
      },
    },
    { new: true }
  );
  if (!doc) throw new NotFoundError(`ProcessingRun ${runId} not found`);
  return doc;
}

/** Marks a run failed. Best-effort bookkeeping — never throws if the run is somehow missing. */
export async function failProcessingRun(runId: string, errorMessage: string): Promise<void> {
  await ProcessingRun.updateOne(
    { runId },
    {
      $set: {
        runStatus: "failed",
        status: "error",
        errorMessage,
        completedAt: new Date(),
      },
    }
  );
}

export async function getProcessingRun(runId: string, tenantFilter: Record<string, unknown>): Promise<ProcessingRunDoc> {
  const doc = await ProcessingRun.findOne({ runId, ...tenantFilter });
  if (!doc) throw new NotFoundError(`ProcessingRun ${runId} not found`);
  return doc;
}
