import { Types } from "mongoose";
import { PayPeriodConfig, PayPeriodConfigDoc } from "../../models/payPeriodConfig.model";
import { PayrollCalendar } from "../../models/payrollCalendar.model";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { CreatePayPeriodConfigInput, UpdatePayPeriodConfigInput } from "./payPeriodConfig.validators";

async function assertPayrollCalendarBelongsToClient(payCalendarId: string, clientId: string): Promise<void> {
  if (!Types.ObjectId.isValid(payCalendarId)) {
    throw new BadRequestError(`payCalendarId ${payCalendarId} is not a valid id`);
  }
  const exists = await PayrollCalendar.exists({ _id: payCalendarId, clientId: new Types.ObjectId(clientId) });
  if (!exists) {
    throw new BadRequestError(`payCalendarId ${payCalendarId} does not exist for client ${clientId}`);
  }
}

export async function listPayPeriodConfigs(tenantFilter: Record<string, unknown>, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    PayPeriodConfig.find(tenantFilter)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    PayPeriodConfig.countDocuments(tenantFilter),
  ]);
  return { items, total, page, pageSize };
}

export async function getPayPeriodConfig(id: string, tenantFilter: Record<string, unknown>): Promise<PayPeriodConfigDoc> {
  const doc = await PayPeriodConfig.findOne({ _id: id, ...tenantFilter }).lean();
  if (!doc) throw new NotFoundError(`Pay period config ${id} not found`);
  return doc;
}

export async function createPayPeriodConfig(input: CreatePayPeriodConfigInput): Promise<PayPeriodConfigDoc> {
  if (input.payCalendarId) {
    await assertPayrollCalendarBelongsToClient(input.payCalendarId, input.clientId);
  }
  // Salaried periods default to no per-day hourly breakdown; every other cadence defaults to
  // producing one — unless the caller explicitly overrides either way.
  const producesHourlyLines = input.producesHourlyLines ?? input.cadence !== "salaried";

  const doc = await PayPeriodConfig.create({
    clientId: new Types.ObjectId(input.clientId),
    name: input.name,
    cadence: input.cadence,
    timezone: input.timezone,
    weekStartDay: input.weekStartDay ?? null,
    anchorDate: input.anchorDate ?? null,
    semiMonthlySplitDay: input.semiMonthlySplitDay ?? 15,
    payDateOffsetDays: input.payDateOffsetDays ?? 0,
    payDateWeekendRule: input.payDateWeekendRule ?? "none",
    payCalendarId: input.payCalendarId ? new Types.ObjectId(input.payCalendarId) : null,
    producesHourlyLines,
  });
  return doc;
}

export async function updatePayPeriodConfig(
  id: string,
  input: UpdatePayPeriodConfigInput,
  tenantFilter: Record<string, unknown>
): Promise<PayPeriodConfigDoc> {
  const doc = await PayPeriodConfig.findOne({ _id: id, ...tenantFilter });
  if (!doc) throw new NotFoundError(`Pay period config ${id} not found`);

  if (input.payCalendarId !== undefined && input.payCalendarId !== null) {
    await assertPayrollCalendarBelongsToClient(input.payCalendarId, String(doc.clientId));
  }

  if (input.name !== undefined) doc.name = input.name;
  if (input.timezone !== undefined) doc.timezone = input.timezone;
  if (input.weekStartDay !== undefined) doc.weekStartDay = input.weekStartDay;
  if (input.anchorDate !== undefined) doc.anchorDate = input.anchorDate;
  if (input.semiMonthlySplitDay !== undefined) doc.semiMonthlySplitDay = input.semiMonthlySplitDay;
  if (input.payDateOffsetDays !== undefined) doc.payDateOffsetDays = input.payDateOffsetDays;
  if (input.payDateWeekendRule !== undefined) doc.payDateWeekendRule = input.payDateWeekendRule;
  if (input.payCalendarId !== undefined) doc.payCalendarId = input.payCalendarId ? new Types.ObjectId(input.payCalendarId) : null;
  if (input.producesHourlyLines !== undefined) doc.producesHourlyLines = input.producesHourlyLines;
  doc.updatedAt = new Date();

  await doc.save();
  return doc;
}
