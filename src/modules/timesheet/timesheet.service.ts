import { Types } from "mongoose";
import { Timesheet, TimesheetDoc, TimesheetLine } from "../../models/timesheet.model";
import { ProcessingAuditEntry } from "../../models/processingAudit.model";
import { TimesheetStatus } from "../../types/domain";
import { BadRequestError, NotFoundError } from "../../utils/errors";

export interface ListTimesheetsFilters {
  employeeId?: string;
  payPeriodId?: string;
  status?: TimesheetStatus;
  includeSuperseded?: boolean;
}

export async function listTimesheets(
  tenantFilter: Record<string, unknown>,
  filters: ListTimesheetsFilters,
  page: number,
  pageSize: number
) {
  const query: Record<string, unknown> = { ...tenantFilter };
  if (filters.employeeId) query.employeeId = filters.employeeId;
  if (filters.payPeriodId) query.payPeriodId = filters.payPeriodId;
  if (filters.status) {
    // An explicit status filter (including "superseded" itself) always wins — that's how a caller
    // asks for history on purpose.
    query.status = filters.status;
  } else if (!filters.includeSuperseded) {
    // Default view mirrors TLM's "latest non-superseded version" behavior for Policy/RuleGroup:
    // superseded versions are hidden unless the caller opts in.
    query.status = { $ne: "superseded" };
  }

  const [items, total] = await Promise.all([
    Timesheet.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Timesheet.countDocuments(query),
  ]);
  return { items, total, page, pageSize };
}

export async function getTimesheet(id: string, tenantFilter: Record<string, unknown>) {
  const doc = await Timesheet.findOne({ _id: id, ...tenantFilter }).lean();
  if (!doc) throw new NotFoundError(`Timesheet ${id} not found`);
  return doc;
}

/**
 * Every line carries the runId of the specific ProcessingRun that produced it — a timesheet's
 * days aren't necessarily all from the same run: an unchanged earlier day's line can still
 * reference an older run that a repeat processing call reused rather than recomputed (see
 * processing.service.ts's cascade-on-change logic), while other days point at freshly created
 * runs. So a complete audit trail has to gather steps across ALL distinct runIds referenced by
 * the timesheet's lines, not just the single top-level `runId` field (which is only the last run
 * created during whichever call produced this version).
 */
export async function getTimesheetAuditTrail(id: string, tenantFilter: Record<string, unknown>) {
  const timesheet = await getTimesheet(id, tenantFilter);
  const businessDateByRunId = new Map(timesheet.lines.map((line) => [String(line.runId), line.businessDate]));
  const runIds =
    timesheet.lines.length > 0 ? [...new Set(timesheet.lines.map((line) => String(line.runId)))] : [String(timesheet.runId)];

  const entries = await ProcessingAuditEntry.find({ runId: { $in: runIds.map((runId) => new Types.ObjectId(runId)) } })
    .sort({ runId: 1, sequenceIndex: 1 })
    .lean();

  return entries.map((entry) => ({ ...entry, businessDate: businessDateByRunId.get(String(entry.runId)) ?? null }));
}

/**
 * Voids a timesheet. TimesheetDoc (a fixed contract for this task) has no dedicated voidReason
 * field, so the reason cannot be persisted/queried yet. Rather than silently swallowing it, it's
 * logged via console.info as an honest stopgap — a follow-up model addition (a nullable
 * `voidReason: string` field, plus whatever queryability that enables) would be the real fix if
 * void reasons ever need to be reported on or searched.
 */
export async function voidTimesheet(
  id: string,
  reason: string,
  tenantFilter: Record<string, unknown>,
  actorNote?: string
): Promise<TimesheetDoc> {
  const doc = await Timesheet.findOne({ _id: id, ...tenantFilter });
  if (!doc) throw new NotFoundError(`Timesheet ${id} not found`);
  if (doc.status === "voided") {
    throw new BadRequestError(`Timesheet ${id} is already voided`);
  }

  console.info(
    `Timesheet ${id} voided${actorNote ? ` by ${actorNote}` : ""}: ${reason}`
  );

  doc.status = "voided";
  doc.updatedAt = new Date();
  await doc.save();
  return doc;
}

/**
 * Input for persisting a finished processing run's computed lines as a new Timesheet version.
 * Not TimesheetDoc itself: version/status/supersedesTimesheetId are computed here, not supplied
 * by the caller (the processing orchestrator, once it exists) — this is deliberately just the
 * subset of TimesheetDoc's own fields that a pipeline run actually produces.
 */
export interface CreateTimesheetVersionInput {
  clientId: Types.ObjectId;
  employeeId: string;
  payPeriodId: string;
  periodStart: Date;
  periodEnd: Date;
  runId: Types.ObjectId;
  lines: TimesheetLine[];
  totalHours: number;
  totalAmount: number;
  payDate: Date;
}

/**
 * Persists a completed processing run's output as a new Timesheet version, superseding any prior
 * `completed` version for the same (clientId, employeeId, payPeriodId) — mirrors TLM's
 * draft/active/superseded Policy/RuleGroup versioning. Not wired into an HTTP route yet: there is
 * no /timesheets/:id/reprocess endpoint until the processing orchestrator (being built separately)
 * exists to call it.
 */
export async function createTimesheetVersion(input: CreateTimesheetVersionInput): Promise<TimesheetDoc> {
  const existing = await Timesheet.findOne({
    clientId: input.clientId,
    employeeId: input.employeeId,
    payPeriodId: input.payPeriodId,
    status: "completed",
  });

  let version = 1;
  let supersedesTimesheetId: Types.ObjectId | null = null;

  if (existing) {
    version = existing.version + 1;
    supersedesTimesheetId = existing._id;
    existing.status = "superseded";
    existing.updatedAt = new Date();
    await existing.save();
  }

  const doc = await Timesheet.create({
    clientId: input.clientId,
    employeeId: input.employeeId,
    payPeriodId: input.payPeriodId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    version,
    status: "completed",
    runId: input.runId,
    lines: input.lines,
    totalHours: input.totalHours,
    totalAmount: input.totalAmount,
    payDate: input.payDate,
    supersedesTimesheetId,
  });
  return doc;
}
