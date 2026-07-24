import { Types } from "mongoose";
import { Punch, PunchDoc } from "../../models/punch.model";
import { Employee } from "../../models/employee.model";
import { Site } from "../../models/site.model";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { CreatePunchInput, CorrectPunchInput } from "./punch.validators";

async function assertEmployeeAndSiteExist(clientId: string, employeeId: string, siteId: string): Promise<void> {
  const [employee, site] = await Promise.all([
    Employee.exists({ clientId: new Types.ObjectId(clientId), employeeId }),
    Site.exists({ clientId: new Types.ObjectId(clientId), siteId }),
  ]);
  if (!employee) throw new BadRequestError(`employeeId ${employeeId} is not a known employee for this client`);
  if (!site) throw new BadRequestError(`siteId ${siteId} is not a known site for this client`);
}

export async function createPunch(input: CreatePunchInput): Promise<PunchDoc> {
  await assertEmployeeAndSiteExist(input.clientId, input.employeeId, input.siteId);
  const doc = await Punch.create({
    clientId: new Types.ObjectId(input.clientId),
    employeeId: input.employeeId,
    siteId: input.siteId,
    task: input.task,
    clockIn: input.clockIn,
    clockOut: input.clockOut ?? null,
    timezone: input.timezone,
    status: input.clockOut ? "closed" : "open",
  });
  return doc;
}

export interface BulkCreateResult {
  accepted: PunchDoc[];
  rejected: { index: number; error: string }[];
}

/** Each punch is validated/created independently — one bad punch in a batch never fails the rest. */
export async function bulkCreatePunches(inputs: CreatePunchInput[]): Promise<BulkCreateResult> {
  const accepted: PunchDoc[] = [];
  const rejected: { index: number; error: string }[] = [];
  for (let index = 0; index < inputs.length; index++) {
    try {
      const doc = await createPunch(inputs[index]);
      accepted.push(doc);
    } catch (err) {
      rejected.push({ index, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { accepted, rejected };
}

export async function listPunches(
  tenantFilter: Record<string, unknown>,
  filters: { employeeId?: string; siteId?: string; from?: Date; to?: Date },
  page: number,
  pageSize: number
) {
  const query: Record<string, unknown> = { ...tenantFilter };
  if (filters.employeeId) query.employeeId = filters.employeeId;
  if (filters.siteId) query.siteId = filters.siteId;
  if (filters.from || filters.to) {
    query.clockIn = {
      ...(filters.from ? { $gte: filters.from } : {}),
      ...(filters.to ? { $lte: filters.to } : {}),
    };
  }
  const [items, total] = await Promise.all([
    Punch.find(query)
      .sort({ clockIn: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Punch.countDocuments(query),
  ]);
  return { items, total, page, pageSize };
}

export async function getPunch(id: string, tenantFilter: Record<string, unknown>): Promise<PunchDoc> {
  const doc = await Punch.findOne({ _id: id, ...tenantFilter }).lean();
  if (!doc) throw new NotFoundError(`Punch ${id} not found`);
  return doc;
}

/**
 * A correction NEVER mutates the original punch — it creates a new Punch document carrying the
 * corrected fields, links back via correctionOfPunchId, and flips the original to status
 * "corrected". The original stays queryable forever for audit purposes.
 *
 * NOTE: does not yet flag any Timesheet covering this punch as stale — Timesheet/processing don't
 * exist yet at this point in the build; that wiring is added once the processing module lands.
 */
export async function correctPunch(id: string, input: CorrectPunchInput, tenantFilter: Record<string, unknown>): Promise<PunchDoc> {
  const original = await Punch.findOne({ _id: id, ...tenantFilter });
  if (!original) throw new NotFoundError(`Punch ${id} not found`);

  const siteId = input.siteId ?? original.siteId;
  if (input.siteId) {
    const siteExists = await Site.exists({ clientId: original.clientId, siteId });
    if (!siteExists) throw new BadRequestError(`siteId ${siteId} is not a known site for this client`);
  }

  const clockIn = input.clockIn ?? original.clockIn;
  const clockOut = input.clockOut !== undefined ? input.clockOut : original.clockOut;
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    throw new BadRequestError("clockOut must be after clockIn");
  }

  const replacement = await Punch.create({
    clientId: original.clientId,
    employeeId: original.employeeId,
    siteId,
    task: input.task ?? original.task,
    clockIn,
    clockOut: clockOut ?? null,
    timezone: input.timezone ?? original.timezone,
    status: clockOut ? "closed" : "open",
    correctionOfPunchId: original._id,
  });

  original.status = "corrected";
  original.updatedAt = new Date();
  await original.save();

  return replacement;
}
