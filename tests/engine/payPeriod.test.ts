import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import {
  resolvePayPeriod,
  resolvePayDateOffset,
  resolvePayDateFromCalendar,
  businessDateInZone,
} from "../../src/utils/payPeriod";
import type { PayPeriodConfigDoc } from "../../src/models/payPeriodConfig.model";

function config(overrides: Partial<PayPeriodConfigDoc>): PayPeriodConfigDoc {
  return {
    _id: new Types.ObjectId(),
    clientId: new Types.ObjectId(),
    name: "test",
    cadence: "monthly",
    timezone: "UTC",
    weekStartDay: null,
    anchorDate: null,
    semiMonthlySplitDay: 15,
    payDateOffsetDays: 0,
    payDateWeekendRule: "none",
    payCalendarId: null,
    producesHourlyLines: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PayPeriodConfigDoc;
}

describe("businessDateInZone", () => {
  it("resolves the correct calendar date across a timezone offset", () => {
    // 3:30am UTC on Jan 5 is still Jan 4 evening in Los Angeles (UTC-8 in January).
    const instant = new Date("2026-01-05T03:30:00.000Z");
    expect(businessDateInZone(instant, "America/Los_Angeles")).toBe("2026-01-04");
    expect(businessDateInZone(instant, "UTC")).toBe("2026-01-05");
  });
});

describe("resolvePayPeriod: daily", () => {
  it("resolves to the single business date", () => {
    const cfg = config({ cadence: "daily", timezone: "UTC" });
    const result = resolvePayPeriod(cfg, new Date("2026-03-10T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-03-10");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-03-10");
  });
});

describe("resolvePayPeriod: weekly", () => {
  it("resolves a mid-week date to its Monday-anchored week", () => {
    const cfg = config({ cadence: "weekly", timezone: "UTC", weekStartDay: 1 }); // Monday
    // 2026-01-07 is a Wednesday
    const result = resolvePayPeriod(cfg, new Date("2026-01-07T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-01-05"); // Monday
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-01-11"); // Sunday
  });

  it("resolves a date exactly ON the week-start day to itself", () => {
    const cfg = config({ cadence: "weekly", timezone: "UTC", weekStartDay: 1 });
    const result = resolvePayPeriod(cfg, new Date("2026-01-05T12:00:00.000Z")); // a Monday
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-01-05");
  });
});

describe("resolvePayPeriod: biweekly", () => {
  it("resolves a date on the anchor to the anchor's own cycle", () => {
    const cfg = config({ cadence: "biweekly", timezone: "UTC", weekStartDay: 0, anchorDate: "2026-01-04" });
    const result = resolvePayPeriod(cfg, new Date("2026-01-04T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-01-04");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-01-17");
  });

  it("resolves a date in the NEXT 14-day cycle correctly", () => {
    const cfg = config({ cadence: "biweekly", timezone: "UTC", weekStartDay: 0, anchorDate: "2026-01-04" });
    const result = resolvePayPeriod(cfg, new Date("2026-01-20T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-01-18");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-01-31");
  });

  it("resolves a date BEFORE the anchor correctly (Math.floor on a negative day-diff, not truncation)", () => {
    const cfg = config({ cadence: "biweekly", timezone: "UTC", weekStartDay: 0, anchorDate: "2026-01-04" });
    // One day before the anchor: diffDays = -1, floor(-1/14) = -1 (not 0, which truncation would give)
    const result = resolvePayPeriod(cfg, new Date("2026-01-03T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2025-12-21");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-01-03");
  });

  it("throws a ConfigurationError-shaped error when anchorDate is missing", () => {
    const cfg = config({ cadence: "biweekly", timezone: "UTC", anchorDate: null });
    expect(() => resolvePayPeriod(cfg, new Date("2026-01-04T12:00:00.000Z"))).toThrow();
  });
});

describe("resolvePayPeriod: semi_monthly", () => {
  it("resolves the first half (1st-15th)", () => {
    const cfg = config({ cadence: "semi_monthly", timezone: "UTC" });
    const result = resolvePayPeriod(cfg, new Date("2026-02-10T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-02-01");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-02-15");
  });

  it("resolves the second half (16th-end of month) for a 28-day February", () => {
    const cfg = config({ cadence: "semi_monthly", timezone: "UTC" });
    const result = resolvePayPeriod(cfg, new Date("2026-02-20T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-02-16");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-02-28"); // 2026 is not a leap year
  });

  it("resolves the second half correctly for a 29-day (leap-year) February", () => {
    const cfg = config({ cadence: "semi_monthly", timezone: "UTC" });
    const result = resolvePayPeriod(cfg, new Date("2028-02-20T12:00:00.000Z"));
    expect(businessDateInZone(result.end, "UTC")).toBe("2028-02-29");
  });

  it("resolves the second half correctly for a 31-day month", () => {
    const cfg = config({ cadence: "semi_monthly", timezone: "UTC" });
    const result = resolvePayPeriod(cfg, new Date("2026-01-20T12:00:00.000Z"));
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-01-31");
  });

  it("resolves a date exactly on the split day into the FIRST half", () => {
    const cfg = config({ cadence: "semi_monthly", timezone: "UTC", semiMonthlySplitDay: 15 });
    const result = resolvePayPeriod(cfg, new Date("2026-02-15T12:00:00.000Z"));
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-02-15");
  });
});

describe("resolvePayPeriod: monthly", () => {
  it("resolves the full calendar month", () => {
    const cfg = config({ cadence: "monthly", timezone: "UTC" });
    const result = resolvePayPeriod(cfg, new Date("2026-04-15T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-04-01");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-04-30");
  });

  it("handles a December 31 -> January rollover date within its own month", () => {
    const cfg = config({ cadence: "monthly", timezone: "UTC" });
    const result = resolvePayPeriod(cfg, new Date("2026-12-31T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-12-01");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-12-31");
  });
});

describe("resolvePayPeriod: salaried", () => {
  it("resolves via calendar-month boundaries and still returns a valid period", () => {
    const cfg = config({ cadence: "salaried", timezone: "UTC", producesHourlyLines: false });
    const result = resolvePayPeriod(cfg, new Date("2026-06-15T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "UTC")).toBe("2026-06-01");
    expect(businessDateInZone(result.end, "UTC")).toBe("2026-06-30");
  });
});

describe("resolvePayPeriod: DST correctness", () => {
  it("resolves a weekly period correctly across a US spring-forward DST transition", () => {
    // 2026-03-08 is the US spring-forward date. A weekly period starting Sunday 2026-03-08 should
    // still span exactly through Saturday 2026-03-14 in calendar-date terms, unaffected by DST.
    const cfg = config({ cadence: "weekly", timezone: "America/New_York", weekStartDay: 0 });
    const result = resolvePayPeriod(cfg, new Date("2026-03-10T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "America/New_York")).toBe("2026-03-08");
    expect(businessDateInZone(result.end, "America/New_York")).toBe("2026-03-14");
  });

  it("resolves a weekly period correctly across a US fall-back DST transition", () => {
    // 2026-11-01 is the US fall-back date.
    const cfg = config({ cadence: "weekly", timezone: "America/New_York", weekStartDay: 0 });
    const result = resolvePayPeriod(cfg, new Date("2026-11-03T12:00:00.000Z"));
    expect(businessDateInZone(result.start, "America/New_York")).toBe("2026-11-01");
    expect(businessDateInZone(result.end, "America/New_York")).toBe("2026-11-07");
  });
});

describe("resolvePayDateOffset", () => {
  it("adds the configured offset with no weekend rule", () => {
    const cfg = config({ payDateOffsetDays: 5, payDateWeekendRule: "none" });
    const periodEnd = new Date("2026-01-31T23:59:59.999Z"); // a Saturday
    const payDate = resolvePayDateOffset(periodEnd, cfg);
    expect(payDate.getUTCDate()).toBe(5);
    expect(payDate.getUTCMonth()).toBe(1); // February (0-indexed)
  });

  it("rolls a weekend pay date to the prior business day", () => {
    const cfg = config({ payDateOffsetDays: 0, payDateWeekendRule: "prior_business_day" });
    const periodEnd = new Date("2026-01-31T00:00:00.000Z"); // a Saturday
    const payDate = resolvePayDateOffset(periodEnd, cfg);
    expect(payDate.getUTCDay()).toBe(5); // Friday
  });

  it("rolls a weekend pay date to the next business day", () => {
    const cfg = config({ payDateOffsetDays: 0, payDateWeekendRule: "next_business_day" });
    const periodEnd = new Date("2026-02-01T00:00:00.000Z"); // a Sunday
    const payDate = resolvePayDateOffset(periodEnd, cfg);
    expect(payDate.getUTCDay()).toBe(1); // Monday
  });
});

describe("resolvePayDateFromCalendar", () => {
  it("returns the matching row's payDate", () => {
    const periodEnd = new Date("2026-01-31T23:59:59.999Z");
    const rows = [{ periodEnd: new Date("2026-01-31T00:00:00.000Z"), payDate: new Date("2026-02-06T00:00:00.000Z") }];
    const result = resolvePayDateFromCalendar(periodEnd, "UTC", rows);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-02-06T00:00:00.000Z");
  });

  it("returns null (never a guess) when no row matches", () => {
    const periodEnd = new Date("2026-01-31T23:59:59.999Z");
    const rows = [{ periodEnd: new Date("2026-02-28T00:00:00.000Z"), payDate: new Date("2026-03-06T00:00:00.000Z") }];
    const result = resolvePayDateFromCalendar(periodEnd, "UTC", rows);
    expect(result).toBeNull();
  });
});
