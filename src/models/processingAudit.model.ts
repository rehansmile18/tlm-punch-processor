import { Schema, model, Types } from "mongoose";
import { PolicyType } from "../types/domain";
import { ProcessingState, SourceAssignmentTag } from "../engine/types";

// One entry per pipeline step, append-only — never mutated after creation. A retroactive
// recompute is always a brand-new runId with its own full entry set; old entries are never
// touched, so "what did this look like before the correction" stays answerable forever.
export interface ProcessingAuditEntryDoc {
  _id: Types.ObjectId;
  runId: Types.ObjectId;
  sequenceIndex: number; // 0-based, across the whole flattened pipeline
  sourceAssignment: SourceAssignmentTag;
  policyId: string;
  policyType: PolicyType;
  policyVersion: number;
  inputState: ProcessingState;
  outputState: ProcessingState;
  humanReadableSummary: string;
  durationMs: number;
  createdAt: Date;
}

const processingAuditEntrySchema = new Schema<ProcessingAuditEntryDoc>(
  {
    runId: { type: Schema.Types.ObjectId, ref: "ProcessingRun", required: true },
    sequenceIndex: { type: Number, required: true },
    sourceAssignment: { type: Schema.Types.Mixed, required: true },
    policyId: { type: String, required: true },
    policyType: { type: String, required: true },
    policyVersion: { type: Number, required: true },
    inputState: { type: Schema.Types.Mixed, required: true },
    outputState: { type: Schema.Types.Mixed, required: true },
    humanReadableSummary: { type: String, required: true },
    durationMs: { type: Number, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "processingAuditEntries" }
);

processingAuditEntrySchema.index({ runId: 1, sequenceIndex: 1 });

export const ProcessingAuditEntry = model<ProcessingAuditEntryDoc>("ProcessingAuditEntry", processingAuditEntrySchema);
