import { Types } from "mongoose";
import { Employee, EmployeeDoc } from "../../models/employee.model";
import { EmployeeGroup } from "../../models/employeeGroup.model";
import { PayPeriodConfig, PayPeriodConfigDoc } from "../../models/payPeriodConfig.model";
import { PayrollCalendar } from "../../models/payrollCalendar.model";
import { Punch } from "../../models/punch.model";
import { ProcessingRun } from "../../models/processingRun.model";
import { TimesheetLine } from "../../models/timesheet.model";
import {
  resolvePayPeriod,
  resolvePayDateOffset,
  resolvePayDateFromCalendar,
  businessDateInZone,
  addCalendarDays,
  resolveWeekStart,
} from "../../utils/payPeriod";
import { buildSegmentsFromPunches, hasOpenPunch } from "../../engine/segments";
import { resolveAndOrderLayers } from "../../engine/resolveLayers";
import { runPipeline, PipelineStep } from "../../engine/pipeline";
import { finalizeAmounts } from "../../engine/finalizeAmounts";
import { processorRegistry } from "../../engine/registry";
import { createInitialState, WeekToDateContext } from "../../engine/types";
import { acquireLock, heartbeat, releaseLock } from "./lock.service";
import { createProcessingRun, completeProcessingRun, failProcessingRun } from "./processingRun.service";
import { recordAuditSteps } from "./processingAudit.service";
import { createTimesheetVersion } from "../timesheet/timesheet.service";
import { ConfigurationError, LockConflictError } from "../../utils/errors";

const ENGINE_VERSION = "1.0.0";

/**
 * Resolves the PayPeriodConfig that governs an employee: the employee's own override if set,
 * otherwise its EmployeeGroup's config — the same two-level "most specific wins" fallback used
 * throughout this service (mirrors TLM's own assignment-specificity idea, just a 2-level version).
 */
async function resolveEmployeePayPeriodConfig(employee: EmployeeDoc): Promise<PayPeriodConfigDoc | null> {
  if (employee.payPeriodConfigId) {
    return PayPeriodConfig.findById(employee.payPeriodConfigId).lean();
  }
  if (employee.employeeGroupId) {
    const group = await EmployeeGroup.findById(employee.employeeGroupId).lean();
    if (group) return PayPeriodConfig.findById(group.payPeriodConfigId).lean();
  }
  return null;
}

/** Every calendar date from `startDateStr` to `endDateStr` inclusive. */
function enumerateBusinessDates(startDateStr: string, endDateStr: string): string[] {
  const dates: string[] = [];
  let cursor = startDateStr;
  // A pay period is bounded (longest supported cadence is ~monthly, ~31 days) — no risk of a
  // runaway loop, but cap defensively in case of a misconfigured period.
  for (let i = 0; i < 62 && cursor <= endDateStr; i++) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

/**
 * Builds the OVERTIME processor's cross-day context by looking at prior COMPLETED
 * ProcessingRuns within the same workweek (never the current in-flight batch's other days,
 * which haven't necessarily persisted yet in a way this reads reliably — always the DB's
 * source of truth). Bounded to the current workweek, matching how CA's own 7th-consecutive-day
 * rule is itself defined relative to one workweek, not a rolling window.
 */
async function buildWeekToDateContext(
  clientId: Types.ObjectId,
  employeeId: string,
  businessDate: string,
  workweekStartDay: number
): Promise<WeekToDateContext> {
  const workweekKey = resolveWeekStart(businessDate, workweekStartDay);
  const priorRuns = await ProcessingRun.find({
    clientId,
    employeeId,
    runStatus: "completed",
    businessDate: { $gte: workweekKey, $lt: businessDate },
  })
    .sort({ businessDate: 1 })
    .lean();

  let cumulativeRegularMinutesPriorDays = 0;
  let cumulativeOtMinutesPriorDays = 0;
  const runsByDate = new Map<string, (typeof priorRuns)[number]>();
  for (const run of priorRuns) {
    if (run.finalState) {
      cumulativeRegularMinutesPriorDays += run.finalState.hourBuckets.regularMinutes;
      cumulativeOtMinutesPriorDays += run.finalState.hourBuckets.otMinutes;
    }
    runsByDate.set(run.businessDate, run);
  }

  let consecutiveDaysWorked = 0;
  let cursor = addCalendarDays(businessDate, -1);
  while (cursor >= workweekKey) {
    const run = runsByDate.get(cursor);
    if (!run?.finalState || run.finalState.rawSegments.length === 0) break;
    consecutiveDaysWorked++;
    cursor = addCalendarDays(cursor, -1);
  }

  return { workweekKey, cumulativeRegularMinutesPriorDays, cumulativeOtMinutesPriorDays, consecutiveDaysWorked };
}

/** Parses a PAYGROUP policy's workweekStart weekday name into 0-6 (Sun-Sat); defaults to Sunday if none resolved. */
function resolveWorkweekStartDay(steps: PipelineStep[]): number {
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const paygroupStep = steps.find((step) => step.policy.policyType === "PAYGROUP");
  if (!paygroupStep) return 0;
  const index = WEEKDAYS.indexOf(paygroupStep.policy.rules?.workweekStart);
  return index === -1 ? 0 : index;
}

export interface ProcessEmployeePeriodResult {
  status: "completed" | "skipped_locked" | "failed";
  payPeriodId?: string;
  timesheetId?: string;
  error?: string;
}

/**
 * Processes one employee's full pay period: resolves the period boundaries, acquires the
 * per-(employee, payPeriodId) lock, runs each business day's punches through the rule pipeline in
 * turn (threading week-to-date context across days), finalizes dollar amounts, and persists the
 * whole thing as one new Timesheet version. Always releases the lock, whatever the outcome.
 */
export async function processEmployeePeriod(
  clientIdStr: string,
  employeeId: string,
  asOfDate: string
): Promise<ProcessEmployeePeriodResult> {
  const clientId = new Types.ObjectId(clientIdStr);
  const employee = await Employee.findOne({ clientId, employeeId }).lean();
  if (!employee) return { status: "failed", error: `Unknown employee ${employeeId} for client ${clientIdStr}` };

  const payPeriodConfig = await resolveEmployeePayPeriodConfig(employee);
  if (!payPeriodConfig) {
    return { status: "failed", error: `No PayPeriodConfig resolved (directly or via employee group) for employee ${employeeId}` };
  }

  // Noon UTC avoids the asOfDate calendar string shifting by a day when re-projected into the
  // config's own timezone for period-boundary resolution.
  const period = resolvePayPeriod(payPeriodConfig, new Date(`${asOfDate}T12:00:00.000Z`));
  const lockRunId = new Types.ObjectId();

  let lock;
  try {
    lock = await acquireLock(employeeId, period.payPeriodId, lockRunId);
  } catch (err) {
    if (err instanceof LockConflictError) return { status: "skipped_locked", payPeriodId: period.payPeriodId };
    throw err;
  }

  try {
    const lines: TimesheetLine[] = [];
    let lastRunId: Types.ObjectId | null = null;
    const startDateStr = businessDateInZone(period.start, payPeriodConfig.timezone);
    const endDateStr = businessDateInZone(period.end, payPeriodConfig.timezone);

    if (payPeriodConfig.producesHourlyLines) {
      for (const businessDate of enumerateBusinessDates(startDateStr, endDateStr)) {
        const dayStart = new Date(`${businessDate}T00:00:00.000Z`);
        const dayEnd = new Date(`${businessDate}T23:59:59.999Z`);
        const punches = await Punch.find({
          clientId,
          employeeId,
          clockIn: { $gte: dayStart, $lte: dayEnd },
          status: { $ne: "corrected" },
        }).lean();

        if (punches.length === 0) continue;
        if (hasOpenPunch(punches)) continue; // day can't be finalized yet — excluded, not guessed at

        const segments = buildSegmentsFromPunches(punches);
        const primarySiteId = segments[0].siteId;
        const primaryTask = segments[0].task;

        const { orderedSteps, unresolvedLevels, unresolvedRefs } = await resolveAndOrderLayers({
          clientId: clientIdStr,
          employeeId,
          date: businessDate,
          locationId: primarySiteId,
        });

        const workweekStartDay = resolveWorkweekStartDay(orderedSteps);
        const weekToDate = await buildWeekToDateContext(clientId, employeeId, businessDate, workweekStartDay);

        const run = await createProcessingRun({
          clientId: clientIdStr,
          employeeId,
          businessDate,
          timezone: employee.timezone,
          punchIds: punches.map((p) => String(p._id)),
          engineVersion: ENGINE_VERSION,
        });

        try {
          const initialState = createInitialState(businessDate, employee.timezone, segments);
          const { finalState, steps } = runPipeline(
            orderedSteps,
            initialState,
            { clientId: clientIdStr, employeeId, siteId: primarySiteId, task: primaryTask, evaluationTz: employee.timezone, weekToDate },
            processorRegistry
          );

          await recordAuditSteps(run._id, steps);
          await completeProcessingRun(run.runId, {
            resolvedLayers: orderedSteps.map((s) => s.sourceAssignment),
            unresolvedLevels,
            unresolvedRefs,
            finalState,
            flags: finalState.violations.map((v) => v.code),
          });

          const amounts = finalizeAmounts(finalState);
          const additionalHours = (finalState.hourBuckets.otMinutes + finalState.hourBuckets.dtMinutes) / 60;
          const totalHours = (finalState.hourBuckets.regularMinutes + finalState.hourBuckets.otMinutes + finalState.hourBuckets.dtMinutes) / 60;

          lines.push({
            businessDate,
            siteId: primarySiteId,
            employeeId,
            task: primaryTask,
            rate: finalState.rate.baseRate,
            rateType: finalState.rate.rateType,
            dailyAmount: amounts.regularAmount,
            additionalAmount: amounts.otAmount + amounts.dtAmount + amounts.differentialAmount + amounts.premiumAmount,
            additionalHours,
            totalHours,
            totalAmount: amounts.totalAmount,
            runId: run._id,
          });
          lastRunId = run._id;
        } catch (err) {
          await failProcessingRun(run.runId, err instanceof Error ? err.message : String(err));
          throw err;
        }

        await heartbeat(lock.lockId, lock.workerId, employeeId, period.payPeriodId);
      }
    }
    // producesHourlyLines === false (salaried): no per-day lines are computed — the Timesheet is
    // still created (uniform downstream contract) but with an empty lines array and zeroed
    // hours/amounts. A real salary-amount source is out of scope for this engine (see PayPeriodConfig's
    // own documentation) — populating a salaried Timesheet's amount is a follow-up, not silently guessed here.

    const payDate = await resolvePayDate(payPeriodConfig, period.end, clientId);

    const timesheet = await createTimesheetVersion({
      clientId,
      employeeId,
      payPeriodId: period.payPeriodId,
      periodStart: period.start,
      periodEnd: period.end,
      runId: lastRunId ?? lockRunId,
      lines,
      totalHours: lines.reduce((sum, line) => sum + line.totalHours, 0),
      totalAmount: lines.reduce((sum, line) => sum + line.totalAmount, 0),
      payDate,
    });

    return { status: "completed", payPeriodId: period.payPeriodId, timesheetId: String(timesheet._id) };
  } catch (err) {
    return { status: "failed", payPeriodId: period.payPeriodId, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await releaseLock(lock.lockId, lock.workerId);
  }
}

async function resolvePayDate(config: PayPeriodConfigDoc, periodEnd: Date, clientId: Types.ObjectId): Promise<Date> {
  if (!config.payCalendarId) return resolvePayDateOffset(periodEnd, config);

  const calendar = await PayrollCalendar.findOne({ _id: config.payCalendarId, clientId }).lean();
  if (!calendar) throw new ConfigurationError(`PayPeriodConfig references a payCalendarId that no longer exists`);

  const payDate = resolvePayDateFromCalendar(periodEnd, config.timezone, calendar.rows);
  if (!payDate) {
    throw new ConfigurationError(
      `No PayrollCalendar row found for period ending ${businessDateInZone(periodEnd, config.timezone)} — add one before processing this period`
    );
  }
  return payDate;
}
