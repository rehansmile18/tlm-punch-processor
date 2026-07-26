import { Schema, Types } from "mongoose";
import { ruleRepoConnection } from "../config/db";

export interface EmployeeGroupDoc {
  _id: Types.ObjectId;
  clientId: Types.ObjectId;
  name: string;
  payPeriodConfigId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const employeeGroupSchema = new Schema<EmployeeGroupDoc>(
  {
    clientId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    payPeriodConfigId: { type: Schema.Types.ObjectId, ref: "PayPeriodConfig", required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "employeeGroups" }
);

employeeGroupSchema.index({ clientId: 1, name: 1 }, { unique: true });

export const EmployeeGroup = ruleRepoConnection.model<EmployeeGroupDoc>("EmployeeGroup", employeeGroupSchema);
