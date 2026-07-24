import { Types } from "mongoose";
import { PayrollCalendar, PayrollCalendarDoc } from "../../models/payrollCalendar.model";
import { NotFoundError } from "../../utils/errors";
import { CreatePayrollCalendarInput, UpdatePayrollCalendarInput } from "./payrollCalendar.validators";

export async function listPayrollCalendars(tenantFilter: Record<string, unknown>, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    PayrollCalendar.find(tenantFilter)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    PayrollCalendar.countDocuments(tenantFilter),
  ]);
  return { items, total, page, pageSize };
}

export async function getPayrollCalendar(id: string, tenantFilter: Record<string, unknown>): Promise<PayrollCalendarDoc> {
  const doc = await PayrollCalendar.findOne({ _id: id, ...tenantFilter }).lean();
  if (!doc) throw new NotFoundError(`Payroll calendar ${id} not found`);
  return doc;
}

export async function createPayrollCalendar(input: CreatePayrollCalendarInput): Promise<PayrollCalendarDoc> {
  const doc = await PayrollCalendar.create({
    clientId: new Types.ObjectId(input.clientId),
    name: input.name,
    rows: input.rows,
  });
  return doc;
}

export async function updatePayrollCalendar(
  id: string,
  input: UpdatePayrollCalendarInput,
  tenantFilter: Record<string, unknown>
): Promise<PayrollCalendarDoc> {
  const doc = await PayrollCalendar.findOne({ _id: id, ...tenantFilter });
  if (!doc) throw new NotFoundError(`Payroll calendar ${id} not found`);
  if (input.name !== undefined) doc.name = input.name;
  if (input.rows !== undefined) doc.rows = input.rows;
  doc.updatedAt = new Date();
  await doc.save();
  return doc;
}
