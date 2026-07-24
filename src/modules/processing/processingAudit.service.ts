import { Types } from "mongoose";
import { ProcessingAuditEntry, ProcessingAuditEntryDoc } from "../../models/processingAudit.model";
import { ProcessingState, SourceAssignmentTag } from "../../engine/types";
import { PolicyType } from "../../types/domain";

/**
 * Mirrors src/engine/pipeline.ts's PipelineStepResult/PipelineResult shapes exactly. Duplicated
 * here rather than imported because pipeline.ts is being built in parallel by another agent and
 * may not be stable yet — whoever wires the engine to this persistence layer should reconcile this
 * into a shared import (a one-line change) once both sides have landed.
 */
export interface PipelineStepResult {
  sequenceIndex: number;
  sourceAssignment: SourceAssignmentTag;
  policyId: string;
  policyType: PolicyType;
  policyVersion: number;
  inputState: ProcessingState;
  outputState: ProcessingState;
  humanReadableSummary: string;
  durationMs: number;
}

export interface PipelineResult {
  finalState: ProcessingState;
  steps: PipelineStepResult[];
}

/**
 * Bulk-inserts one append-only ProcessingAuditEntry per pipeline step. Never call update/delete
 * against this collection anywhere — a retroactive recompute is always a brand-new runId with its
 * own full entry set, so old entries are never touched.
 */
export async function recordAuditSteps(runId: Types.ObjectId, steps: PipelineStepResult[]): Promise<void> {
  if (steps.length === 0) return;
  await ProcessingAuditEntry.insertMany(
    steps.map((step) => ({
      runId,
      sequenceIndex: step.sequenceIndex,
      sourceAssignment: step.sourceAssignment,
      policyId: step.policyId,
      policyType: step.policyType,
      policyVersion: step.policyVersion,
      inputState: step.inputState,
      outputState: step.outputState,
      humanReadableSummary: step.humanReadableSummary,
      durationMs: step.durationMs,
      createdAt: new Date(),
    }))
  );
}

export async function getAuditTrailForRun(runId: Types.ObjectId): Promise<ProcessingAuditEntryDoc[]> {
  return ProcessingAuditEntry.find({ runId }).sort({ sequenceIndex: 1 }).lean();
}
