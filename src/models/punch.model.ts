import { Schema, Types } from "mongoose";
import { ruleRepoConnection } from "../config/db";

export interface PunchDoc {
  _id: Types.ObjectId;
  clientId: Types.ObjectId;
  employeeId: string; // matches Employee.employeeId (external ref, not the Mongo _id)
  siteId: string; // matches Site.siteId
  task: string; // matches Task.name
  clockIn: Date;
  clockOut: Date | null; // null while the shift is still open
  timezone: string; // IANA tz this punch was recorded in — authoritative unless absent
  status: "open" | "closed" | "corrected" | "rejected";
  // A correction never mutates the original punch — it creates a new Punch document and links
  // back here, so the original stays intact for audit purposes.
  correctionOfPunchId: Types.ObjectId | null;
  rejectionReason: string | null; // set when status = "rejected" (e.g. clockOut before clockIn)
  createdAt: Date;
  updatedAt: Date;
}

const punchSchema = new Schema<PunchDoc>(
  {
    clientId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: String, required: true },
    siteId: { type: String, required: true },
    task: { type: String, required: true },
    clockIn: { type: Date, required: true },
    clockOut: { type: Date, default: null },
    timezone: { type: String, required: true },
    status: { type: String, enum: ["open", "closed", "corrected", "rejected"], required: true, default: "open" },
    correctionOfPunchId: { type: Schema.Types.ObjectId, ref: "Punch", default: null },
    rejectionReason: { type: String, default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "punches" }
);

punchSchema.index({ clientId: 1, employeeId: 1, clockIn: 1 });
punchSchema.index({ clientId: 1, siteId: 1, clockIn: 1 });

export const Punch = ruleRepoConnection.model<PunchDoc>("Punch", punchSchema);
