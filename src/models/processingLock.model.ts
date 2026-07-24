import { Schema, model, Types } from "mongoose";

export type LockStatus = "held" | "released";

export interface ProcessingLockDoc {
  _id: Types.ObjectId;
  employeeId: string;
  payPeriodId: string;
  status: LockStatus;
  workerId: string; // hostname:pid:uuid — identifies the holder for diagnostics
  acquiredAt: Date;
  heartbeatAt: Date; // renewed periodically; staleness is judged off this, not acquiredAt
  expiresAt: Date; // heartbeatAt + lease duration
  runId: Types.ObjectId;
}

const processingLockSchema = new Schema<ProcessingLockDoc>(
  {
    employeeId: { type: String, required: true },
    payPeriodId: { type: String, required: true },
    status: { type: String, enum: ["held", "released"], required: true, default: "held" },
    workerId: { type: String, required: true },
    acquiredAt: { type: Date, required: true },
    heartbeatAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    runId: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: "processingLocks" }
);

// The invariant this whole locking design rests on: at most one HELD lock per
// (employeeId, payPeriodId) at any time. Released rows are kept (not deleted) for history/audit —
// the partial filter means they never collide with a fresh acquisition.
processingLockSchema.index({ employeeId: 1, payPeriodId: 1 }, { unique: true, partialFilterExpression: { status: "held" } });
processingLockSchema.index({ status: 1, expiresAt: 1 }); // for the stale-lock reaper's sweep

export const ProcessingLock = model<ProcessingLockDoc>("ProcessingLock", processingLockSchema);
