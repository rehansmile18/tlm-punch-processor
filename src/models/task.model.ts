import { Schema, model, Types } from "mongoose";

export interface TaskDoc {
  _id: Types.ObjectId;
  clientId: Types.ObjectId;
  name: string;
  code: string | null; // matched against PAY_DIFFERENTIAL.conditions[].code in TLM policies
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<TaskDoc>(
  {
    clientId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: null, trim: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "tasks" }
);

taskSchema.index({ clientId: 1, name: 1 }, { unique: true });

export const Task = model<TaskDoc>("Task", taskSchema);
