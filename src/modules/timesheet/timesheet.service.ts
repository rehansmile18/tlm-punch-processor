import { PipelineStage, Types } from "mongoose";
import { Timesheet, TimesheetDoc, TimesheetLine } from "../../models/timesheet.model";
import { ProcessingAuditEntry } from "../../models/processingAudit.model";
import { PayPeriodConfig } from "../../models/payPeriodConfig.model";
import { TimesheetStatus } from "../../types/domain";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { businessDateInZone, enumerateBusinessDates, extractPayPeriodConfigId } from "../../utils/payPeriod";

export interface ListTimesheetsFilters {
  employeeId?: string;
  payPeriodId?: string;
  status?: TimesheetStatus;
  includeSuperseded?: boolean;
}

export interface PeriodDates {
  periodStartDate: string;
  periodEndDate: string;
}

/**
 * periodStart/periodEnd are stored as exact UTC instants marking local midnight and local
 * 23:59:59.999 IN THE PAY PERIOD CONFIG'S OWN TIMEZONE (see utils/payPeriod.ts) — not the
 * viewer's. Formatting those instants directly in whatever timezone happens to be reading them
 * (a browser rendering "MMM d, yyyy" in its own local time) can round the displayed calendar date
 * forward or back by a day, e.g. a period ending "2026-01-11 23:59:59.999 UTC" reads as "Jan 12"
 * to a viewer in a positive UTC offset. periodStartDate/periodEndDate are the period's own,
 * unambiguous calendar-date strings — safe to display as-is in any timezone.
 */
async function attachPeriodDates<T extends { payPeriodId: string; periodStart: Date; periodEnd: Date }>(
  items: T[]
): Promise<(T & PeriodDates)[]> {
  const configIds = new Set<string>();
  for (const item of items) {
    try {
      const configId = extractPayPeriodConfigId(item.payPeriodId);
      if (Types.ObjectId.isValid(configId)) configIds.add(configId);
    } catch {
      // malformed payPeriodId — this item falls back to UTC below
    }
  }
  const configs = configIds.size > 0 ? await PayPeriodConfig.find({ _id: { $in: [...configIds] } }).lean() : [];
  const timezoneByConfigId = new Map(configs.map((c) => [String(c._id), c.timezone]));

  return items.map((item) => {
    let timezone = "UTC";
    try {
      const configId = extractPayPeriodConfigId(item.payPeriodId);
      timezone = timezoneByConfigId.get(configId) ?? "UTC";
    } catch {
      // keep the UTC fallback
    }
    return {
      ...item,
      periodStartDate: businessDateInZone(item.periodStart, timezone),
      periodEndDate: businessDateInZone(item.periodEnd, timezone),
    };
  });
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

  const [rawItems, total] = await Promise.all([
    Timesheet.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Timesheet.countDocuments(query),
  ]);
  const items = await attachPeriodDates(rawItems);
  return { items, total, page, pageSize };
}

export async function getTimesheet(id: string, tenantFilter: Record<string, unknown>) {
  const doc = await Timesheet.findOne({ _id: id, ...tenantFilter }).lean();
  if (!doc) throw new NotFoundError(`Timesheet ${id} not found`);
  const [withDates] = await attachPeriodDates([doc]);
  return withDates;
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

export interface ListTimesheetSiteGroupsFilters {
  siteId?: string;
  siteIds?: string[];
  payPeriodId?: string;
  includeSuperseded?: boolean;
}

export interface TimesheetSiteGroup extends PeriodDates {
  siteId: string;
  payPeriodId: string;
  periodStart: Date;
  periodEnd: Date;
  payDate: Date;
  employeeCount: number;
  totalHours: number;
  totalAmount: number;
  stale: boolean;
}

/**
 * Groups existing per-employee Timesheets by (siteId, payPeriodId) for display purposes — the
 * persisted unit of record stays exactly one Timesheet per (employee, payPeriodId), with its own
 * locking/versioning/void/audit trail untouched. This just re-shapes lines across the employee
 * timesheets that share a pay period into "who worked this site during this period" groups. An
 * employee who split time across two sites in the same period appears in both sites' groups,
 * each only counting the lines that actually belong to that site.
 *
 * payPeriodId always embeds its PayPeriodConfig's own ObjectId (see utils/payPeriod.ts), so two
 * employees only ever share a payPeriodId when they share the exact same config — periodStart/
 * periodEnd/payDate are therefore identical across every timesheet in a group, safe to take with
 * $first rather than needing to reconcile mismatched values.
 */
export async function listTimesheetSiteGroups(
  tenantFilter: Record<string, unknown>,
  filters: ListTimesheetSiteGroupsFilters,
  page: number,
  pageSize: number
): Promise<{ items: TimesheetSiteGroup[]; total: number; page: number; pageSize: number }> {
  const match: Record<string, unknown> = { ...tenantFilter };
  if (filters.payPeriodId) match.payPeriodId = filters.payPeriodId;
  if (!filters.includeSuperseded) match.status = { $ne: "superseded" };

  const lineMatch: Record<string, unknown> = {};
  if (filters.siteId) lineMatch["lines.siteId"] = filters.siteId;
  else if (filters.siteIds?.length) lineMatch["lines.siteId"] = { $in: filters.siteIds };

  const basePipeline: PipelineStage[] = [
    { $match: match },
    { $unwind: "$lines" },
    ...(Object.keys(lineMatch).length > 0 ? [{ $match: lineMatch }] : []),
    {
      $group: {
        _id: { siteId: "$lines.siteId", payPeriodId: "$payPeriodId" },
        employeeIds: { $addToSet: "$lines.employeeId" },
        totalHours: { $sum: "$lines.totalHours" },
        totalAmount: { $sum: "$lines.totalAmount" },
        periodStart: { $first: "$periodStart" },
        periodEnd: { $first: "$periodEnd" },
        payDate: { $first: "$payDate" },
        anyStale: { $max: { $cond: ["$stale", 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        siteId: "$_id.siteId",
        payPeriodId: "$_id.payPeriodId",
        employeeCount: { $size: "$employeeIds" },
        totalHours: 1,
        totalAmount: 1,
        periodStart: 1,
        periodEnd: 1,
        payDate: 1,
        stale: { $eq: ["$anyStale", 1] },
      },
    },
    { $sort: { periodStart: -1, siteId: 1 } },
  ];

  const [rawItems, countResult] = await Promise.all([
    Timesheet.aggregate([...basePipeline, { $skip: (page - 1) * pageSize }, { $limit: pageSize }]),
    Timesheet.aggregate([...basePipeline, { $count: "count" }]),
  ]);
  const items = await attachPeriodDates(rawItems);

  return { items, total: countResult[0]?.count ?? 0, page, pageSize };
}

export interface TimesheetGridCell {
  task: string;
  totalHours: number;
  totalAmount: number;
  rateType: "hourly" | "salary";
  rate: number;
}

export interface TimesheetGridRow {
  employeeId: string;
  timesheetId: string;
  status: TimesheetStatus;
  stale: boolean;
  version: number;
  cellsByDate: Record<string, TimesheetGridCell>;
  totalHours: number;
  totalAmount: number;
}

export interface TimesheetGrid extends PeriodDates {
  siteId: string;
  payPeriodId: string;
  periodStart: Date;
  periodEnd: Date;
  payDate: Date;
  dates: string[];
  rows: TimesheetGridRow[];
  totals: { employeeCount: number; totalHours: number; totalAmount: number };
}

/**
 * Builds the site+period grid: one row per employee who has at least one line at `siteId` within
 * `payPeriodId`, one column per calendar date spanning the period (not just the dates someone
 * actually worked, so gaps read as blanks rather than being silently skipped).
 */
export async function getTimesheetGridForSite(
  siteId: string,
  payPeriodId: string,
  tenantFilter: Record<string, unknown>,
  includeSuperseded?: boolean
): Promise<TimesheetGrid> {
  const query: Record<string, unknown> = { ...tenantFilter, payPeriodId, "lines.siteId": siteId };
  if (!includeSuperseded) query.status = { $ne: "superseded" };

  const timesheets = await Timesheet.find(query).lean();
  if (timesheets.length === 0) {
    throw new NotFoundError(`No timesheets found for site ${siteId} in pay period ${payPeriodId}`);
  }

  const periodStart = timesheets[0].periodStart;
  const periodEnd = timesheets[0].periodEnd;
  const payDate = timesheets[0].payDate;

  // Production payPeriodId values always embed a real PayPeriodConfig id (see utils/payPeriod.ts),
  // but this is purely for computing grid column headers — fall back to UTC rather than throwing
  // if a payPeriodId ever doesn't follow that format (e.g. a hand-seeded/legacy value).
  let timezone = "UTC";
  try {
    const configId = extractPayPeriodConfigId(payPeriodId);
    if (Types.ObjectId.isValid(configId)) {
      const payPeriodConfig = await PayPeriodConfig.findById(configId).lean();
      if (payPeriodConfig) timezone = payPeriodConfig.timezone;
    }
  } catch {
    // malformed payPeriodId — keep the UTC fallback
  }
  const dates = enumerateBusinessDates(businessDateInZone(periodStart, timezone), businessDateInZone(periodEnd, timezone));

  const rows: TimesheetGridRow[] = timesheets.map((ts) => {
    const matchedLines = ts.lines.filter((line) => line.siteId === siteId);
    const cellsByDate: Record<string, TimesheetGridCell> = {};
    for (const line of matchedLines) {
      cellsByDate[line.businessDate] = {
        task: line.task,
        totalHours: line.totalHours,
        totalAmount: line.totalAmount,
        rateType: line.rateType,
        rate: line.rate,
      };
    }
    return {
      employeeId: ts.employeeId,
      timesheetId: String(ts._id),
      status: ts.status,
      stale: ts.stale,
      version: ts.version,
      cellsByDate,
      totalHours: matchedLines.reduce((sum, line) => sum + line.totalHours, 0),
      totalAmount: matchedLines.reduce((sum, line) => sum + line.totalAmount, 0),
    };
  });
  rows.sort((a, b) => a.employeeId.localeCompare(b.employeeId));

  return {
    siteId,
    payPeriodId,
    periodStart,
    periodEnd,
    // The period's own calendar-date boundaries, not a browser-timezone-dependent reading of the
    // UTC instants above — same values as dates[0]/dates[dates.length - 1], no extra lookup needed.
    periodStartDate: dates[0],
    periodEndDate: dates[dates.length - 1],
    payDate,
    dates,
    rows,
    totals: {
      employeeCount: rows.length,
      totalHours: rows.reduce((sum, row) => sum + row.totalHours, 0),
      totalAmount: rows.reduce((sum, row) => sum + row.totalAmount, 0),
    },
  };
}
