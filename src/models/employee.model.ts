import { Schema, model, Types } from "mongoose";

export interface EmployeeDoc {
  _id: Types.ObjectId;
  employeeId: string; // external reference id (matches whatever upstream HRIS/payroll uses)
  clientId: Types.ObjectId;
  employeeGroupId: Types.ObjectId | null;
  timezone: string; // IANA tz, e.g. "America/Los_Angeles"
  payPeriodConfigId: Types.ObjectId | null; // falls back to the employeeGroup's config when null
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const employeeSchema = new Schema<EmployeeDoc>(
  {
    employeeId: { type: String, required: true, trim: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    employeeGroupId: { type: Schema.Types.ObjectId, ref: "EmployeeGroup", default: null },
    timezone: { type: String, required: true },
    payPeriodConfigId: { type: Schema.Types.ObjectId, ref: "PayPeriodConfig", default: null },
    status: { type: String, enum: ["active", "inactive"], required: true, default: "active" },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "employees" }
);

employeeSchema.index({ clientId: 1, employeeId: 1 }, { unique: true });

export const Employee = model<EmployeeDoc>("Employee", employeeSchema);
