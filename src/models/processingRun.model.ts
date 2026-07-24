import { Schema, model, Types } from "mongoose";
import { ProcessingRunStatus, PROCESSING_RUN_STATUSES } from "../types/domain";
import { ProcessingState, SourceAssignmentTag } from "../engine/types";

export type ResolvedLayerSummary = SourceAssignmentTag;

export interface ProcessingRunDoc {
  _id: Types.ObjectId;
  runId: string;
  clientId: Types.ObjectId;
  employeeId: string;
  businessDate: string;
  timezone: string;
  punchIds: Types.ObjectId[];
  resolvedLayers: ResolvedLayerSummary[]; // in pipeline execution order
  unresolvedLevels: string[];
  unresolvedRefs: { targetType: string; ref: unknown }[];
  finalState: ProcessingState | null; // null until the run completes
  status: "ok" | "needs_review" | "error";
  runStatus: ProcessingRunStatus; // lifecycle status (queued/processing/completed/...), distinct from the correctness `status` above
  flags: string[];
  engineVersion: string;
  supersedesRunId: Types.ObjectId | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

const processingRunSchema = new Schema<ProcessingRunDoc>(
  {
    runId: { type: String, required: true, unique: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: String, required: true },
    businessDate: { type: String, required: true },
    timezone: { type: String, required: true },
    punchIds: { type: [Schema.Types.ObjectId], default: [] },
    resolvedLayers: { type: Schema.Types.Mixed, default: [] },
    unresolvedLevels: { type: [String], default: [] },
    unresolvedRefs: { type: Schema.Types.Mixed, default: [] },
    finalState: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ["ok", "needs_review", "error"], required: true, default: "ok" },
    runStatus: { type: String, enum: PROCESSING_RUN_STATUSES, required: true, default: "queued" },
    flags: { type: [String], default: [] },
    engineVersion: { type: String, required: true },
    supersedesRunId: { type: Schema.Types.ObjectId, ref: "ProcessingRun", default: null },
    errorMessage: { type: String, default: null },
    startedAt: { type: Date, required: true, default: () => new Date() },
    completedAt: { type: Date, default: null },
  },
  { collection: "processingRuns" }
);

processingRunSchema.index({ clientId: 1, employeeId: 1, businessDate: 1 });

export const ProcessingRun = model<ProcessingRunDoc>("ProcessingRun", processingRunSchema);
