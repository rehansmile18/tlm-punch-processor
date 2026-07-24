import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { PayPeriodConfigDoc } from "../models/payPeriodConfig.model";
import { ConfigurationError } from "./errors";

export interface ResolvedPayPeriod {
  start: Date; // real UTC instant = start-of-day (00:00:00) in config.timezone
  end: Date; // real UTC instant = end-of-day (23:59:59.999) in config.timezone
  payPeriodId: string;
}

// --- Pure calendar-date arithmetic, deliberately NOT using date-fns's plain functions (getDay,
// addDays, etc.) — those operate using the JS runtime's LOCAL system timezone for calendar
// semantics, which would make period-boundary math silently depend on the server's own TZ
// setting. Everything here works on "YYYY-MM-DD" strings via native UTC Date methods instead,
// which are deterministic regardless of the host machine's configured timezone.

function calendarDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function calendarDateStr(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addCalendarDays(dateStr: string, days: number): string {
  const date = calendarDate(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return calendarDateStr(date);
}

function dayOfWeek(dateStr: string): number {
  return calendarDate(dateStr).getUTCDay(); // 0=Sun..6=Sat
}

/** The most recent occurrence of `weekStartDay` at/before `dateStr` — the workweek anchor a given date falls into. */
export function resolveWeekStart(dateStr: string, weekStartDay: number): string {
  let start = dateStr;
  while (dayOfWeek(start) !== weekStartDay) {
    start = addCalendarDays(start, -1);
  }
  return start;
}

function diffCalendarDays(fromStr: string, toStr: string): number {
  return Math.round((calendarDate(toStr).getTime() - calendarDate(fromStr).getTime()) / 86_400_000);
}

function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of the NEXT month is the last day of THIS month — a standard trick for UTC-safe month lengths.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// --- Timezone-aware boundary conversion: a calendar date string becomes a real UTC instant only
// at the very last step, once we know which calendar day starts/ends the period.

function toRealStart(dateStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr} 00:00:00.000`, timezone);
}

function toRealEnd(dateStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr} 23:59:59.999`, timezone);
}

/** The calendar date (in the config's own timezone) that an instant falls on — used to bucket a punch into a period. */
export function businessDateInZone(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}

function resolveDaily(config: PayPeriodConfigDoc, dateStr: string): ResolvedPayPeriod {
  return {
    start: toRealStart(dateStr, config.timezone),
    end: toRealEnd(dateStr, config.timezone),
    payPeriodId: `D-${String(config._id)}-${dateStr}`,
  };
}

function resolveWeekly(config: PayPeriodConfigDoc, dateStr: string): ResolvedPayPeriod {
  const weekStartDay = config.weekStartDay ?? 0;
  let start = dateStr;
  // At most 6 iterations — walks back to the most recent occurrence of weekStartDay at/before dateStr.
  while (dayOfWeek(start) !== weekStartDay) {
    start = addCalendarDays(start, -1);
  }
  const end = addCalendarDays(start, 6);
  return {
    start: toRealStart(start, config.timezone),
    end: toRealEnd(end, config.timezone),
    payPeriodId: `W-${String(config._id)}-${start}`,
  };
}

function resolveBiweekly(config: PayPeriodConfigDoc, dateStr: string): ResolvedPayPeriod {
  if (!config.anchorDate) throw new ConfigurationError('Pay period config is missing anchorDate, required for cadence "biweekly"');
  // Math.floor (not truncation) so a date BEFORE the anchor still buckets into the correct
  // 14-day cycle — e.g. 1 day before the anchor gives diffDays=-1, floor(-1/14)=-1, correctly
  // landing in the cycle immediately preceding the anchor rather than the same cycle as the anchor.
  const diffDays = diffCalendarDays(config.anchorDate, dateStr);
  const cycleIndex = Math.floor(diffDays / 14);
  const start = addCalendarDays(config.anchorDate, cycleIndex * 14);
  const end = addCalendarDays(start, 13);
  return {
    start: toRealStart(start, config.timezone),
    end: toRealEnd(end, config.timezone),
    payPeriodId: `B-${String(config._id)}-${start}`,
  };
}

function resolveSemiMonthly(config: PayPeriodConfigDoc, dateStr: string): ResolvedPayPeriod {
  const splitDay = config.semiMonthlySplitDay ?? 15;
  const [y, m, d] = dateStr.split("-").map(Number);
  const monthStr = pad2(m);
  if (d <= splitDay) {
    const start = `${y}-${monthStr}-01`;
    const end = `${y}-${monthStr}-${pad2(splitDay)}`;
    return {
      start: toRealStart(start, config.timezone),
      end: toRealEnd(end, config.timezone),
      payPeriodId: `SM-${String(config._id)}-${y}-${monthStr}-1`,
    };
  }
  const lastDay = daysInMonth(y, m);
  const start = `${y}-${monthStr}-${pad2(splitDay + 1)}`;
  const end = `${y}-${monthStr}-${pad2(lastDay)}`;
  return {
    start: toRealStart(start, config.timezone),
    end: toRealEnd(end, config.timezone),
    payPeriodId: `SM-${String(config._id)}-${y}-${monthStr}-2`,
  };
}

function resolveMonthly(config: PayPeriodConfigDoc, dateStr: string): ResolvedPayPeriod {
  const [y, m] = dateStr.split("-").map(Number);
  const monthStr = pad2(m);
  const lastDay = daysInMonth(y, m);
  const start = `${y}-${monthStr}-01`;
  const end = `${y}-${monthStr}-${pad2(lastDay)}`;
  return {
    start: toRealStart(start, config.timezone),
    end: toRealEnd(end, config.timezone),
    payPeriodId: `M-${String(config._id)}-${y}-${monthStr}`,
  };
}

/**
 * Resolves which pay period a punch (or any instant) falls into, given a PayPeriodConfig's
 * cadence. All boundary math happens in the config's OWN timezone, never UTC or the server's
 * local time — see businessDateInZone above.
 */
export function resolvePayPeriod(config: PayPeriodConfigDoc, punchDate: Date): ResolvedPayPeriod {
  const dateStr = businessDateInZone(punchDate, config.timezone);
  switch (config.cadence) {
    case "daily":
      return resolveDaily(config, dateStr);
    case "weekly":
      return resolveWeekly(config, dateStr);
    case "biweekly":
      return resolveBiweekly(config, dateStr);
    case "semi_monthly":
      return resolveSemiMonthly(config, dateStr);
    case "monthly":
      return resolveMonthly(config, dateStr);
    case "salaried":
      // Salaried periods still need SOME boundary for grouping/reporting purposes — a calendar
      // month is the simplest, most common default. Documented simplification: a client wanting a
      // salaried employee tracked on a different cadence should configure that cadence directly
      // (with producesHourlyLines: false) rather than relying on "salaried" to imply a schedule.
      return resolveMonthly(config, dateStr);
  }
}

/** Offset-mode payable date: periodEnd + payDateOffsetDays, optionally rolled off a weekend. */
export function resolvePayDateOffset(periodEnd: Date, config: PayPeriodConfigDoc): Date {
  const payDate = new Date(periodEnd.getTime());
  payDate.setUTCDate(payDate.getUTCDate() + (config.payDateOffsetDays ?? 0));

  const rule = config.payDateWeekendRule ?? "none";
  if (rule === "none") return payDate;

  const dow = payDate.getUTCDay(); // 0=Sun, 6=Sat
  if (dow !== 0 && dow !== 6) return payDate;

  if (rule === "prior_business_day") {
    payDate.setUTCDate(payDate.getUTCDate() - (dow === 0 ? 2 : 1)); // Sun->Fri(-2), Sat->Fri(-1)
  } else if (rule === "next_business_day") {
    payDate.setUTCDate(payDate.getUTCDate() + (dow === 6 ? 2 : 1)); // Sat->Mon(+2), Sun->Mon(+1)
  }
  return payDate;
}

/**
 * Calendar-mode payable date: looks up an explicit PayrollCalendar row matching this period's end
 * date. Returns null (never a guess) when no row matches — the caller must treat that as a
 * configuration error, not silently fall back to the offset mode.
 */
export function resolvePayDateFromCalendar(
  periodEnd: Date,
  timezone: string,
  calendarRows: { periodEnd: Date; payDate: Date }[]
): Date | null {
  const periodEndDateStr = businessDateInZone(periodEnd, timezone);
  const match = calendarRows.find((row) => calendarDateStr(row.periodEnd) === periodEndDateStr);
  return match ? match.payDate : null;
}
