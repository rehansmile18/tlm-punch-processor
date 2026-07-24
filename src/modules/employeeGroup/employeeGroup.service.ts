import { Types } from "mongoose";
import { EmployeeGroup, EmployeeGroupDoc } from "../../models/employeeGroup.model";
import { PayPeriodConfig } from "../../models/payPeriodConfig.model";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { CreateEmployeeGroupInput, UpdateEmployeeGroupInput } from "./employeeGroup.validators";

/** payPeriodConfigId is a required FK — it must exist AND belong to the same client. */
async function assertPayPeriodConfigBelongsToClient(payPeriodConfigId: string, clientId: string): Promise<void> {
  if (!Types.ObjectId.isValid(payPeriodConfigId)) {
    throw new BadRequestError(`payPeriodConfigId ${payPeriodConfigId} is not a valid id`);
  }
  const exists = await PayPeriodConfig.exists({ _id: payPeriodConfigId, clientId: new Types.ObjectId(clientId) });
  if (!exists) {
    throw new BadRequestError(`payPeriodConfigId ${payPeriodConfigId} does not exist for client ${clientId}`);
  }
}

export async function listEmployeeGroups(tenantFilter: Record<string, unknown>, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    EmployeeGroup.find(tenantFilter)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    EmployeeGroup.countDocuments(tenantFilter),
  ]);
  return { items, total, page, pageSize };
}

export async function getEmployeeGroup(id: string, tenantFilter: Record<string, unknown>): Promise<EmployeeGroupDoc> {
  const doc = await EmployeeGroup.findOne({ _id: id, ...tenantFilter }).lean();
  if (!doc) throw new NotFoundError(`Employee group ${id} not found`);
  return doc;
}

export async function createEmployeeGroup(input: CreateEmployeeGroupInput): Promise<EmployeeGroupDoc> {
  await assertPayPeriodConfigBelongsToClient(input.payPeriodConfigId, input.clientId);
  const doc = await EmployeeGroup.create({
    clientId: new Types.ObjectId(input.clientId),
    name: input.name,
    payPeriodConfigId: new Types.ObjectId(input.payPeriodConfigId),
  });
  return doc.toObject();
}

export async function updateEmployeeGroup(
  id: string,
  input: UpdateEmployeeGroupInput,
  tenantFilter: Record<string, unknown>
): Promise<EmployeeGroupDoc> {
  const current = await EmployeeGroup.findOne({ _id: id, ...tenantFilter });
  if (!current) throw new NotFoundError(`Employee group ${id} not found`);

  if (input.payPeriodConfigId !== undefined) {
    await assertPayPeriodConfigBelongsToClient(input.payPeriodConfigId, String(current.clientId));
    current.payPeriodConfigId = new Types.ObjectId(input.payPeriodConfigId);
  }
  if (input.name !== undefined) current.name = input.name;
  current.updatedAt = new Date();

  await current.save();
  return current.toObject();
}
