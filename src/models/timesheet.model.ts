import { Schema, model, Types } from "mongoose";
import { TimesheetStatus, TIMESHEET_STATUSES } from "../types/domain";

// One line per business day (or a single collapsed line for a producesHourlyLines=false salaried
// period) — exactly the attribute set the user asked for.
export interface TimesheetLine {
  businessDate: string;
  siteId: string;
  employeeId: string;
  task: string;
  rate: number;
  rateType: "hourly" | "salary";
  dailyAmount: number;
  additionalAmount: number;
  additionalHours: number;
  totalHours: number;
  totalAmount: number;
  runId: Types.ObjectId; // the ProcessingRun that produced this line
}

export interface TimesheetDoc {
  _id: Types.ObjectId;
  clientId: Types.ObjectId;
  employeeId: string;
  payPeriodId: string;
  periodStart: Date;
  periodEnd: Date;
  version: number;
  status: TimesheetStatus;
  runId: Types.ObjectId; // the ProcessingRun that produced this specific version
  lines: TimesheetLine[];
  totalHours: number;
  totalAmount: number;
  payDate: Date;
  stale: boolean; // set when a punch under this period is corrected after finalization
  supersedesTimesheetId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const timesheetLineSchema = new Schema<TimesheetLine>(
  {
    businessDate: { type: String, required: true },
    siteId: { type: String, required: true },
    employeeId: { type: String, required: true },
    task: { type: String, required: true },
    rate: { type: Number, required: true },
    rateType: { type: String, enum: ["hourly", "salary"], required: true },
    dailyAmount: { type: Number, required: true },
    additionalAmount: { type: Number, required: true },
    additionalHours: { type: Number, required: true },
    totalHours: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    runId: { type: Schema.Types.ObjectId, ref: "ProcessingRun", required: true },
  },
  { _id: false }
);

const timesheetSchema = new Schema<TimesheetDoc>(
  {
    clientId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: String, required: true },
    payPeriodId: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    version: { type: Number, required: true, default: 1 },
    status: { type: String, enum: TIMESHEET_STATUSES, required: true, default: "draft" },
    runId: { type: Schema.Types.ObjectId, ref: "ProcessingRun", required: true },
    lines: { type: [timesheetLineSchema], default: [] },
    totalHours: { type: Number, required: true, default: 0 },
    totalAmount: { type: Number, required: true, default: 0 },
    payDate: { type: Date, required: true },
    stale: { type: Boolean, required: true, default: false },
    supersedesTimesheetId: { type: Schema.Types.ObjectId, ref: "Timesheet", default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "timesheets" }
);

timesheetSchema.index({ clientId: 1, employeeId: 1, payPeriodId: 1, version: -1 });

export const Timesheet = model<TimesheetDoc>("Timesheet", timesheetSchema);
