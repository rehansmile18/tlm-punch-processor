import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, seedAuthedUser, authed, TestContext } from "./helpers";
import { setMockResolveLayeredHandler, resetMockRuleRepo } from "./mockRuleRepo";
import { Employee } from "../src/models/employee.model";
import { PayPeriodConfig } from "../src/models/payPeriodConfig.model";
import { Punch, PunchDoc } from "../src/models/punch.model";
import { Timesheet } from "../src/models/timesheet.model";
import { ProcessingRun } from "../src/models/processingRun.model";
import { processEmployeePeriod } from "../src/modules/processing/processing.service";

/**
 * Site/Task/Punch CRUD (including corrections) now lives in tlm-backend, not this repo — but this
 * suite still needs to simulate "a punch got corrected" to exercise the ENGINE's cascade-reprocessing
 * reaction to it. This replicates tlm-backend's punch.service.ts correction semantics directly
 * against the Punch model this engine still reads: never mutate the original in place, create a
 * replacement linked via correctionOfPunchId, and flip the original to "corrected".
 */
async function correctPunchForTest(id: string, clockOut: Date): Promise<PunchDoc> {
  const original = await Punch.findOne({ _id: id });
  if (!original) throw new Error(`Punch ${id} not found`);
  const replacement = await Punch.create({
    clientId: original.clientId,
    employeeId: original.employeeId,
    siteId: original.siteId,
    task: original.task,
    clockIn: original.clockIn,
    clockOut,
    timezone: original.timezone,
    status: "closed",
    correctionOfPunchId: original._id,
  });
  original.status = "corrected";
  original.updatedAt = new Date();
  await original.save();
  return replacement;
}

interface FixtureRule {
  policyId: string;
  version?: number;
  policyType: string;
  name?: string;
  rules: Record<string, unknown>;
}

// Returns the FULL resolve-layered response shape ({layers, consideredAssignments}) — the mock
// handler's return value is JSON-serialized as-is, so this must match ruleRepositoryClient's
// ResolveLayeredResult exactly, not just a single layer.
function mockLayer(overrides: {
  targetType?: string;
  priority?: number;
  ruleGroupId?: string;
  policies: FixtureRule[];
}) {
  const layer = {
    targetType: overrides.targetType ?? "EMPLOYEE",
    assignment: { _id: "a1", priority: overrides.priority ?? 10, ruleGroupId: overrides.ruleGroupId ?? "rg1" },
    ruleGroup: { ruleGroupId: overrides.ruleGroupId ?? "rg1", version: 1 },
    policies: overrides.policies.map((p) => ({ version: 1, name: p.policyType, ...p })),
    unresolvedRefs: [],
  };
  return { layers: [layer], consideredAssignments: 1 };
}

const RATE_POLICY: FixtureRule = {
  policyId: "p-rate",
  policyType: "RATE",
  rules: { rateType: "hourly", minimumWage: 20, minimumWageSource: "test" },
};

const OVERTIME_POLICY: FixtureRule = {
  policyId: "p-ot",
  policyType: "OVERTIME",
  rules: {
    workweekStartDay: "Monday",
    dailyOTThresholdHours: 8,
    dailyDTThresholdHours: null,
    weeklyOTThresholdHours: 40,
    seventhConsecutiveDayRule: { enabled: false, otAfterHours: 0, dtAfterHours: null },
  },
};

describe("processing.service: processEmployeePeriod", () => {
  let ctx: TestContext;
  let clientId: Types.ObjectId;

  beforeAll(async () => {
    ctx = await setupTestContext();
  });
  afterAll(() => ctx.teardown());

  beforeEach(() => {
    clientId = new Types.ObjectId();
  });
  afterEach(() => resetMockRuleRepo());

  async function seedBasics(cadenceOverrides: Record<string, unknown> = {}) {
    const payPeriodConfig = await PayPeriodConfig.create({
      clientId,
      name: "Weekly",
      cadence: "weekly",
      timezone: "UTC",
      weekStartDay: 1, // Monday
      payDateOffsetDays: 5,
      producesHourlyLines: true,
      ...cadenceOverrides,
    });
    await Employee.create({
      clientId,
      employeeId: "emp-1",
      timezone: "UTC",
      payPeriodConfigId: payPeriodConfig._id,
    });
    return payPeriodConfig;
  }

  it("processes a single 9-hour day: 8h regular + 1h OT, correct dollar amounts and pay date", async () => {
    await seedBasics();
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY, OVERTIME_POLICY] }));

    await Punch.create({
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-05T09:00:00.000Z"), // Monday
      clockOut: new Date("2026-01-05T18:00:00.000Z"), // 9 hours
      timezone: "UTC",
      status: "closed",
    });

    const result = await processEmployeePeriod(String(clientId), "emp-1", "2026-01-05");
    expect(result.status).toBe("completed");
    expect(result.timesheetId).toBeDefined();

    const timesheet = await Timesheet.findById(result.timesheetId).lean();
    expect(timesheet).not.toBeNull();
    expect(timesheet!.lines).toHaveLength(1);
    const line = timesheet!.lines[0];
    expect(line.totalHours).toBe(9);
    expect(line.additionalHours).toBe(1);
    expect(line.dailyAmount).toBe(160); // 8h * $20
    expect(line.additionalAmount).toBe(30); // 1h OT * $20 * 1.5
    expect(line.totalAmount).toBe(190);
    expect(line.rate).toBe(20);

    // period: Mon 2026-01-05 .. Sun 2026-01-11; payDateOffsetDays=5 -> 2026-01-16
    expect(timesheet!.payDate.toISOString().slice(0, 10)).toBe("2026-01-16");
  });

  it("still computes real hours/amount from a punch when the resolved rule group has no OVERTIME policy", async () => {
    // Regression: a rule group with ONLY a RATE policy resolves fine, but hourBuckets is only ever
    // populated by the OVERTIME processor (see engine/defaultHours.ts) — without this fallback, a
    // client that hasn't configured OT rules would silently get a real rate but zero hours/pay for
    // real worked time.
    await seedBasics();
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY] }));

    await Punch.create({
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-05T09:00:00.000Z"), // Monday
      clockOut: new Date("2026-01-05T17:00:00.000Z"), // 8 hours
      timezone: "UTC",
      status: "closed",
    });

    const result = await processEmployeePeriod(String(clientId), "emp-1", "2026-01-05");
    expect(result.status).toBe("completed");

    const timesheet = await Timesheet.findById(result.timesheetId).lean();
    const line = timesheet!.lines[0];
    expect(line.totalHours).toBe(8);
    expect(line.additionalHours).toBe(0);
    expect(line.dailyAmount).toBe(160); // 8h * $20
    expect(line.totalAmount).toBe(160);
  });

  it("excludes a day with an open punch instead of guessing", async () => {
    await seedBasics();
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY, OVERTIME_POLICY] }));

    await Punch.create({
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-06T09:00:00.000Z"), // Tuesday, still open
      clockOut: null,
      timezone: "UTC",
      status: "open",
    });

    const result = await processEmployeePeriod(String(clientId), "emp-1", "2026-01-06");
    expect(result.status).toBe("completed");
    const timesheet = await Timesheet.findById(result.timesheetId).lean();
    expect(timesheet!.lines).toHaveLength(0);
  });

  it("promotes today's regular hours into OT once the weekly threshold is crossed by prior completed days", async () => {
    await seedBasics();
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY, OVERTIME_POLICY] }));

    // Mon-Thu: 4 days x 10h = 40h already worked (regular, since daily threshold is 8h... wait
    // 10h/day would itself produce daily OT). Use exactly 8h/day for 5 days so the daily split
    // alone gives all-regular, and only the WEEKLY threshold (40h) triggers promotion on day 5.
    const days = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]; // Mon-Thu, 8h each = 32h
    for (const day of days) {
      await Punch.create({
        clientId,
        employeeId: "emp-1",
        siteId: "site-1",
        task: "Stocking",
        clockIn: new Date(`${day}T09:00:00.000Z`),
        clockOut: new Date(`${day}T17:00:00.000Z`), // 8h
        timezone: "UTC",
        status: "closed",
      });
      const r = await processEmployeePeriod(String(clientId), "emp-1", day);
      expect(r.status).toBe("completed");
    }

    // Friday: another 8h. Cumulative regular prior to Friday = 32h; +8h today = 40h, exactly at
    // the weekly threshold (not over) -> no promotion yet, all 8h regular today.
    await Punch.create({
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-09T09:00:00.000Z"),
      clockOut: new Date("2026-01-09T17:00:00.000Z"),
      timezone: "UTC",
      status: "closed",
    });
    const fridayResult = await processEmployeePeriod(String(clientId), "emp-1", "2026-01-09");
    expect(fridayResult.status).toBe("completed");

    const fridayRun = await ProcessingRun.findOne({ clientId, employeeId: "emp-1", businessDate: "2026-01-09" }).lean();
    expect(fridayRun!.finalState!.hourBuckets.regularMinutes).toBe(480); // 8h, no promotion (exactly at 40h)
    expect(fridayRun!.finalState!.hourBuckets.otMinutes).toBe(0);

    // Saturday: 4 more hours. Cumulative regular prior = 40h; +4h today = 44h, 4h over the 40h
    // weekly threshold -> all 4 of today's hours get promoted to OT.
    await Punch.create({
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-10T09:00:00.000Z"),
      clockOut: new Date("2026-01-10T13:00:00.000Z"), // 4h
      timezone: "UTC",
      status: "closed",
    });
    const saturdayResult = await processEmployeePeriod(String(clientId), "emp-1", "2026-01-10");
    expect(saturdayResult.status).toBe("completed");

    const saturdayRun = await ProcessingRun.findOne({ clientId, employeeId: "emp-1", businessDate: "2026-01-10" }).lean();
    expect(saturdayRun!.finalState!.hourBuckets.regularMinutes).toBe(0);
    expect(saturdayRun!.finalState!.hourBuckets.otMinutes).toBe(240); // all 4h promoted
  });

  it("days before any change are REUSED (not reprocessed) on a repeat call — same runId both times", async () => {
    await seedBasics();
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY, OVERTIME_POLICY] }));
    await Punch.create({
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-05T09:00:00.000Z"),
      clockOut: new Date("2026-01-05T17:00:00.000Z"),
      timezone: "UTC",
      status: "closed",
    });

    await processEmployeePeriod(String(clientId), "emp-1", "2026-01-05");
    const firstRun = await ProcessingRun.findOne({ clientId, employeeId: "emp-1", businessDate: "2026-01-05" }).lean();

    // Nothing changed — reprocessing the same period again must reuse Monday's existing run
    // rather than creating a second one for the same day.
    await processEmployeePeriod(String(clientId), "emp-1", "2026-01-05");
    const runsForMonday = await ProcessingRun.find({ clientId, employeeId: "emp-1", businessDate: "2026-01-05" }).lean();
    expect(runsForMonday).toHaveLength(1);
    expect(String(runsForMonday[0]._id)).toBe(String(firstRun!._id));
  });

  it("correcting an EARLIER day cascades forward and recalculates LATER days in the same workweek, even though their own punches never changed", async () => {
    await seedBasics();
    // No daily threshold (null) — only the weekly one matters here, so a correction to Monday's
    // hours changes Monday's REGULAR minutes directly rather than spilling into Monday's own daily
    // OT, which would otherwise never reach the weekly cumulative that Friday depends on.
    const weeklyOnlyOvertime = {
      ...OVERTIME_POLICY,
      rules: { ...OVERTIME_POLICY.rules, dailyOTThresholdHours: null },
    };
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY, weeklyOnlyOvertime] }));

    // Mon-Fri, 8h/day = 40h exactly at the weekly threshold — no promotion anywhere yet.
    const days = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
    for (const day of days) {
      await Punch.create({
        clientId,
        employeeId: "emp-1",
        siteId: "site-1",
        task: "Stocking",
        clockIn: new Date(`${day}T09:00:00.000Z`),
        clockOut: new Date(`${day}T17:00:00.000Z`),
        timezone: "UTC",
        status: "closed",
      });
    }
    await processEmployeePeriod(String(clientId), "emp-1", "2026-01-09");

    const fridayBefore = await ProcessingRun.findOne({ clientId, employeeId: "emp-1", businessDate: "2026-01-09" })
      .sort({ completedAt: -1 })
      .lean();
    expect(fridayBefore!.finalState!.hourBuckets.regularMinutes).toBe(480); // 8h, no promotion (exactly 40h)
    expect(fridayBefore!.finalState!.hourBuckets.otMinutes).toBe(0);

    // A manager corrects Monday's punch to add 2 extra hours (8h -> 10h) — with no daily threshold,
    // all 10h count as Monday's own regular time, raising the week's cumulative regular total.
    // Uses the real correction path (never mutates the original punch in place — creates a new
    // replacement with a fresh updatedAt and marks the original "corrected", which the
    // orchestrator's query already excludes).
    const mondayPunch = await Punch.findOne({ clientId, employeeId: "emp-1", clockIn: new Date("2026-01-05T09:00:00.000Z") });
    await correctPunchForTest(String(mondayPunch!._id), new Date("2026-01-05T19:00:00.000Z"));

    await processEmployeePeriod(String(clientId), "emp-1", "2026-01-09");

    const fridayAfter = await ProcessingRun.findOne({ clientId, employeeId: "emp-1", businessDate: "2026-01-09" })
      .sort({ completedAt: -1 })
      .lean();
    // Friday's punches never changed, but Monday's correction added 2h of cumulative regular time
    // this week, pushing the week total from 40h to 42h — Friday's own 8h must now be reclassified:
    // 2h of it promoted to OT so the week caps at exactly 40h regular.
    expect(String(fridayAfter!._id)).not.toBe(String(fridayBefore!._id)); // a genuinely NEW run, not reused
    expect(fridayAfter!.finalState!.hourBuckets.regularMinutes).toBe(360); // 6h
    expect(fridayAfter!.finalState!.hourBuckets.otMinutes).toBe(120); // 2h promoted
  });

  it("reprocessing the same period creates a new superseding Timesheet version", async () => {
    await seedBasics();
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY, OVERTIME_POLICY] }));

    await Punch.create({
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-05T09:00:00.000Z"),
      clockOut: new Date("2026-01-05T17:00:00.000Z"),
      timezone: "UTC",
      status: "closed",
    });

    const first = await processEmployeePeriod(String(clientId), "emp-1", "2026-01-05");
    expect(first.status).toBe("completed");
    const firstTimesheet = await Timesheet.findById(first.timesheetId).lean();
    expect(firstTimesheet!.version).toBe(1);

    const second = await processEmployeePeriod(String(clientId), "emp-1", "2026-01-05");
    expect(second.status).toBe("completed");
    expect(second.timesheetId).not.toBe(first.timesheetId);
    const secondTimesheet = await Timesheet.findById(second.timesheetId).lean();
    expect(secondTimesheet!.version).toBe(2);
    expect(String(secondTimesheet!.supersedesTimesheetId)).toBe(String(firstTimesheet!._id));

    const supersededFirst = await Timesheet.findById(first.timesheetId).lean();
    expect(supersededFirst!.status).toBe("superseded");
  });

  it("produces an empty-lines Timesheet for a salaried (producesHourlyLines: false) config", async () => {
    await seedBasics({ cadence: "salaried", producesHourlyLines: false, weekStartDay: null });
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY] }));

    const result = await processEmployeePeriod(String(clientId), "emp-1", "2026-01-15");
    expect(result.status).toBe("completed");
    const timesheet = await Timesheet.findById(result.timesheetId).lean();
    expect(timesheet!.lines).toHaveLength(0);
    expect(timesheet!.totalHours).toBe(0);
  });

  it("returns failed for an unknown employee", async () => {
    await seedBasics();
    const result = await processEmployeePeriod(String(clientId), "emp-nonexistent", "2026-01-05");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/Unknown employee/);
  });

  it("returns failed when no PayPeriodConfig can be resolved", async () => {
    await Employee.create({ clientId, employeeId: "emp-no-config", timezone: "UTC" });
    const result = await processEmployeePeriod(String(clientId), "emp-no-config", "2026-01-05");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/No PayPeriodConfig/);
  });

  it("the SAME employee+period cannot be processed concurrently — one call is skipped_locked", async () => {
    await seedBasics();
    // A slow mock handler widens the race window so both calls are genuinely in-flight together.
    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY, OVERTIME_POLICY] }));
    await Punch.create({
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-05T09:00:00.000Z"),
      clockOut: new Date("2026-01-05T17:00:00.000Z"),
      timezone: "UTC",
      status: "closed",
    });

    const [a, b] = await Promise.allSettled([
      processEmployeePeriod(String(clientId), "emp-1", "2026-01-05"),
      processEmployeePeriod(String(clientId), "emp-1", "2026-01-05"),
    ]);
    const statuses = [a, b].map((r) => (r.status === "fulfilled" ? r.value.status : "threw"));
    expect(statuses).toContain("completed");
    expect(statuses).toContain("skipped_locked");
  });
});

describe("processing API: POST /processing/runs", () => {
  let ctx: TestContext;
  let clientId: Types.ObjectId;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await setupTestContext();
  });
  afterAll(() => ctx.teardown());

  beforeEach(async () => {
    clientId = new Types.ObjectId();
    adminToken = seedAuthedUser({ role: "CLIENT_ADMIN", clientId: String(clientId) });

    const payPeriodConfig = await PayPeriodConfig.create({
      clientId,
      name: "Weekly",
      cadence: "weekly",
      timezone: "UTC",
      weekStartDay: 1,
      payDateOffsetDays: 5,
      producesHourlyLines: true,
    });
    await Employee.create({ clientId, employeeId: "emp-a", timezone: "UTC", payPeriodConfigId: payPeriodConfig._id });
    await Employee.create({ clientId, employeeId: "emp-b", timezone: "UTC", payPeriodConfigId: payPeriodConfig._id });

    setMockResolveLayeredHandler(() => mockLayer({ policies: [RATE_POLICY, OVERTIME_POLICY] }));

    await Punch.create({
      clientId,
      employeeId: "emp-a",
      siteId: "site-1",
      task: "Stocking",
      clockIn: new Date("2026-01-05T09:00:00.000Z"),
      clockOut: new Date("2026-01-05T17:00:00.000Z"),
      timezone: "UTC",
      status: "closed",
    });
    // emp-b has no punches at all this period -> still "completed" with an empty-lines timesheet.
  });
  afterEach(() => resetMockRuleRepo());

  it("processes a batch of employees and returns per-employee outcomes (207)", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/processing/runs", {
      clientId: String(clientId),
      employeeIds: ["emp-a", "emp-b"],
      asOfDate: "2026-01-05",
    });
    expect(res.status).toBe(207);
    expect(res.body.summary.completed).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.find((i: { employeeId: string }) => i.employeeId === "emp-a").status).toBe("completed");
  });

  it("a lock conflict for one employee doesn't fail the rest of the batch", async () => {
    // Pre-acquire the lock for emp-a's period out from under the batch call by processing it once
    // first via a deliberately-held lock: simplest way to force a conflict deterministically is to
    // fire two overlapping batches that both include emp-a.
    const [first, second] = await Promise.allSettled([
      authed(ctx.app, adminToken).post("/api/v1/processing/runs", {
        clientId: String(clientId),
        employeeIds: ["emp-a"],
        asOfDate: "2026-01-05",
      }),
      authed(ctx.app, adminToken).post("/api/v1/processing/runs", {
        clientId: String(clientId),
        employeeIds: ["emp-a"],
        asOfDate: "2026-01-05",
      }),
    ]);
    const bodies = [first, second]
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<{ body: { items: { status: string }[] } }>).value.body);
    const allStatuses = bodies.flatMap((b) => b.items.map((i: { status: string }) => i.status));
    expect(allStatuses).toContain("completed");
    expect(allStatuses).toContain("skipped_locked");
  });

  it("rejects a request for a clientId that isn't the caller's own", async () => {
    const otherClientId = new Types.ObjectId();
    const res = await authed(ctx.app, adminToken).post("/api/v1/processing/runs", {
      clientId: String(otherClientId),
      employeeIds: ["emp-a"],
      asOfDate: "2026-01-05",
    });
    expect(res.status).toBe(403);
  });

  it("rejects an empty employeeIds array", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/processing/runs", {
      clientId: String(clientId),
      employeeIds: [],
      asOfDate: "2026-01-05",
    });
    expect(res.status).toBe(400);
  });
});
