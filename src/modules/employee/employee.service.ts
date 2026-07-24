import { Types } from "mongoose";
import { Employee, EmployeeDoc } from "../../models/employee.model";
import { EmployeeGroup } from "../../models/employeeGroup.model";
import { PayPeriodConfig } from "../../models/payPeriodConfig.model";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { CreateEmployeeInput, UpdateEmployeeInput } from "./employee.validators";

/**
 * An employee group is always client-owned. An employee may only point at an employee group
 * belonging to the SAME client it is being created/updated under — otherwise a client admin who
 * learned another tenant's employeeGroupId could bind an employee to it. Rejects unknown or
 * cross-tenant employeeGroupIds at write time (mirrors TLM's assertRuleGroupOwnedByClient).
 */
async function assertEmployeeGroupOwnedByClient(clientId: string, employeeGroupId: string): Promise<void> {
  const owned = await EmployeeGroup.exists({ _id: employeeGroupId, clientId: new Types.ObjectId(clientId) });
  if (!owned) {
    throw new BadRequestError(`employeeGroupId ${employeeGroupId} does not resolve to an employee group owned by this client`);
  }
}

/** Same cross-tenant guard as assertEmployeeGroupOwnedByClient, but for the optional PayPeriodConfig override. */
async function assertPayPeriodConfigOwnedByClient(clientId: string, payPeriodConfigId: string): Promise<void> {
  const owned = await PayPeriodConfig.exists({ _id: payPeriodConfigId, clientId: new Types.ObjectId(clientId) });
  if (!owned) {
    throw new BadRequestError(`payPeriodConfigId ${payPeriodConfigId} does not resolve to a pay period config owned by this client`);
  }
}

export async function listEmployees(
  tenantFilter: Record<string, unknown>,
  employeeGroupId: string | undefined,
  page: number,
  pageSize: number
) {
  const query: Record<string, unknown> = { ...tenantFilter };
  if (employeeGroupId) query.employeeGroupId = employeeGroupId;
  const [items, total] = await Promise.all([
    Employee.find(query)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Employee.countDocuments(query),
  ]);
  return { items, total, page, pageSize };
}

export async function getEmployee(employeeId: string, tenantFilter: Record<string, unknown>) {
  const doc = await Employee.findOne({ _id: employeeId, ...tenantFilter }).lean();
  if (!doc) throw new NotFoundError(`Employee ${employeeId} not found`);
  return doc;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<EmployeeDoc> {
  if (input.employeeGroupId) {
    await assertEmployeeGroupOwnedByClient(input.clientId, input.employeeGroupId);
  }
  if (input.payPeriodConfigId) {
    await assertPayPeriodConfigOwnedByClient(input.clientId, input.payPeriodConfigId);
  }
  const doc = await Employee.create({
    clientId: new Types.ObjectId(input.clientId),
    employeeId: input.employeeId,
    employeeGroupId: input.employeeGroupId ? new Types.ObjectId(input.employeeGroupId) : null,
    timezone: input.timezone,
    payPeriodConfigId: input.payPeriodConfigId ? new Types.ObjectId(input.payPeriodConfigId) : null,
    status: input.status ?? "active",
  });
  return doc;
}

export async function updateEmployee(
  employeeId: string,
  input: UpdateEmployeeInput,
  tenantFilter: Record<string, unknown>
): Promise<EmployeeDoc> {
  const doc = await Employee.findOne({ _id: employeeId, ...tenantFilter });
  if (!doc) throw new NotFoundError(`Employee ${employeeId} not found`);

  // FK checks re-run against the employee's OWN clientId (never the caller's), so this still
  // guards correctly even though clientId itself can never be patched.
  const clientId = String(doc.clientId);
  if (input.employeeGroupId) {
    await assertEmployeeGroupOwnedByClient(clientId, input.employeeGroupId);
  }
  if (input.payPeriodConfigId) {
    await assertPayPeriodConfigOwnedByClient(clientId, input.payPeriodConfigId);
  }

  if (input.employeeId !== undefined) doc.employeeId = input.employeeId;
  if (input.employeeGroupId !== undefined) {
    doc.employeeGroupId = input.employeeGroupId ? new Types.ObjectId(input.employeeGroupId) : null;
  }
  if (input.timezone !== undefined) doc.timezone = input.timezone;
  if (input.payPeriodConfigId !== undefined) {
    doc.payPeriodConfigId = input.payPeriodConfigId ? new Types.ObjectId(input.payPeriodConfigId) : null;
  }
  if (input.status !== undefined) doc.status = input.status;

  await doc.save();
  return doc;
}
