import { describe, expect, it } from "vitest";
import { processOvertime } from "../../src/engine/processors/overtime";
import { createInitialState, ProcessingContext, RemotePolicy, Segment } from "../../src/engine/types";

function segment(startIso: string, endIso: string): Segment {
  return {
    startIso,
    endIso,
    sourcePunchIds: ["punch-1"],
    siteId: "site-1",
    task: "default",
    paid: true,
    createdByPolicyId: null,
  };
}

function overtimePolicy(rules: {
  workweekStartDay?: string;
  dailyOTThresholdHours?: number | null;
  dailyDTThresholdHours?: number | null;
  weeklyOTThresholdHours?: number;
  seventhConsecutiveDayRule?: { enabled: boolean; otAfterHours: number; dtAfterHours: number | null };
}): RemotePolicy {
  return {
    policyId: "policy-overtime-1",
    version: 1,
    policyType: "OVERTIME",
    name: "Test Overtime Policy",
    rules: {
      workweekStartDay: "Sunday",
      dailyOTThresholdHours: null,
      dailyDTThresholdHours: null,
      weeklyOTThresholdHours: 40,
      seventhConsecutiveDayRule: { enabled: false, otAfterHours: 8, dtAfterHours: null },
      ...rules,
    },
  };
}

function ctxWith(weekToDate: Partial<ProcessingContext["weekToDate"]>): ProcessingContext {
  return {
    clientId: "client-1",
    employeeId: "employee-1",
    siteId: "site-1",
    task: "default",
    evaluationTz: "America/New_York",
    sourceAssignment: {
      assignmentId: "assignment-1",
      targetType: "EMPLOYEE",
      priority: 1,
      ruleGroupId: "rule-group-1",
      ruleGroupVersion: 1,
    },
    weekToDate: {
      workweekKey: "2026-W29",
      cumulativeRegularMinutesPriorDays: 0,
      cumulativeOtMinutesPriorDays: 0,
      consecutiveDaysWorked: 1,
      ...weekToDate,
    },
  };
}

describe("processOvertime", () => {
  it("puts everything in regular when no daily/weekly thresholds are crossed", () => {
    // 8-hour shift, no daily OT/DT thresholds, weekly threshold of 40h nowhere near crossed.
    const state = createInitialState("2026-07-20", "America/New_York", [
      segment("2026-07-20T09:00:00.000Z", "2026-07-20T17:00:00.000Z"),
    ]);
    const policy = overtimePolicy({ dailyOTThresholdHours: null, dailyDTThresholdHours: null, weeklyOTThresholdHours: 40 });
    const ctx = ctxWith({ cumulativeRegularMinutesPriorDays: 0 });

    const result = processOvertime(state, policy, ctx);

    expect(result.hourBuckets).toEqual({ regularMinutes: 480, otMinutes: 0, dtMinutes: 0 });
    // Pure function: input state must be untouched.
    expect(state.hourBuckets).toEqual({ regularMinutes: 0, otMinutes: 0, dtMinutes: 0 });
  });

  it("splits a 10-hour shift into 8h regular + 2h OT against an 8h daily threshold", () => {
    const state = createInitialState("2026-07-20", "America/New_York", [
      segment("2026-07-20T09:00:00.000Z", "2026-07-20T19:00:00.000Z"), // 10 hours
    ]);
    const policy = overtimePolicy({ dailyOTThresholdHours: 8, dailyDTThresholdHours: null, weeklyOTThresholdHours: 40 });
    const ctx = ctxWith({ cumulativeRegularMinutesPriorDays: 0 });

    const result = processOvertime(state, policy, ctx);

    expect(result.hourBuckets).toEqual({ regularMinutes: 480, otMinutes: 120, dtMinutes: 0 });
  });

  it("promotes regular minutes into OT once the weekly 40h line is crossed by prior-days minutes", () => {
    // Daily split alone gives regular=480min(8h), ot=120min(2h) for the 10-hour shift (same as above).
    // priorRegular=2100min(35h) + today's regular 480min(8h) = 2580min(43h), 180min(3h) over the
    // 2400min(40h) weekly threshold. promoted = min(180, 480) = 180.
    // Final: regularMinutes = 480 - 180 = 300min(5h); otMinutes = 120 (daily) + 180 (promoted) = 300min(5h).
    const state = createInitialState("2026-07-20", "America/New_York", [
      segment("2026-07-20T09:00:00.000Z", "2026-07-20T19:00:00.000Z"), // 10 hours
    ]);
    const policy = overtimePolicy({ dailyOTThresholdHours: 8, dailyDTThresholdHours: null, weeklyOTThresholdHours: 40 });
    const ctx = ctxWith({ cumulativeRegularMinutesPriorDays: 2100 });

    const result = processOvertime(state, policy, ctx);

    expect(result.hourBuckets).toEqual({ regularMinutes: 300, otMinutes: 300, dtMinutes: 0 });
    // Conservation check: buckets must still sum to the shift's total minutes (600).
    const totalBucketed = result.hourBuckets.regularMinutes + result.hourBuckets.otMinutes + result.hourBuckets.dtMinutes;
    expect(totalBucketed).toBe(600);
  });

  it("applies the 7th-consecutive-day override and ignores daily/weekly logic entirely", () => {
    // 14-hour shift. otAfterHours=8, dtAfterHours=12 => regular=8h(480min), ot=4h(240min), dt=2h(120min).
    // dailyOTThresholdHours=10 and weeklyOTThresholdHours=1 are deliberately set to values that would
    // produce a completely different split if they were consulted — proving the override short-circuits them.
    const state = createInitialState("2026-07-20", "America/New_York", [
      segment("2026-07-20T06:00:00.000Z", "2026-07-20T20:00:00.000Z"), // 14 hours
    ]);
    const policy = overtimePolicy({
      dailyOTThresholdHours: 10,
      dailyDTThresholdHours: null,
      weeklyOTThresholdHours: 1,
      seventhConsecutiveDayRule: { enabled: true, otAfterHours: 8, dtAfterHours: 12 },
    });
    const ctx = ctxWith({ consecutiveDaysWorked: 6, cumulativeRegularMinutesPriorDays: 0 });

    const result = processOvertime(state, policy, ctx);

    expect(result.hourBuckets).toEqual({ regularMinutes: 480, otMinutes: 240, dtMinutes: 120 });
  });

  it("does not apply the 7th-day override when consecutiveDaysWorked is below 6", () => {
    const state = createInitialState("2026-07-20", "America/New_York", [
      segment("2026-07-20T06:00:00.000Z", "2026-07-20T20:00:00.000Z"), // 14 hours
    ]);
    const policy = overtimePolicy({
      dailyOTThresholdHours: 10,
      dailyDTThresholdHours: null,
      weeklyOTThresholdHours: 40,
      seventhConsecutiveDayRule: { enabled: true, otAfterHours: 8, dtAfterHours: 12 },
    });
    const ctx = ctxWith({ consecutiveDaysWorked: 5, cumulativeRegularMinutesPriorDays: 0 });

    const result = processOvertime(state, policy, ctx);

    // Falls through to daily/weekly logic: regular=10h(600min), remaining 4h(240min) all OT (no daily DT set).
    expect(result.hourBuckets).toEqual({ regularMinutes: 600, otMinutes: 240, dtMinutes: 0 });
  });

  it("overwrites hourBuckets from scratch — second call's result depends only on workSegments/context, not prior hourBuckets", () => {
    const segments = [segment("2026-07-20T09:00:00.000Z", "2026-07-20T19:00:00.000Z")]; // 10 hours
    const ctx = ctxWith({ cumulativeRegularMinutesPriorDays: 0 });

    const policyA = overtimePolicy({ dailyOTThresholdHours: 8, dailyDTThresholdHours: null, weeklyOTThresholdHours: 40 });
    const policyB = overtimePolicy({ dailyOTThresholdHours: 6, dailyDTThresholdHours: null, weeklyOTThresholdHours: 40 });

    const freshState = createInitialState("2026-07-20", "America/New_York", segments);

    // First call, simulating a LOCATION-assigned layer's OVERTIME policy.
    const afterFirstCall = processOvertime(freshState, policyA, ctx);
    expect(afterFirstCall.hourBuckets).toEqual({ regularMinutes: 480, otMinutes: 120, dtMinutes: 0 });

    // Second call, simulating a later-running EMPLOYEE-assigned layer's differently-configured
    // OVERTIME policy, fed the state produced by the first call (whose hourBuckets are non-zero).
    const afterSecondCall = processOvertime(afterFirstCall, policyB, ctx);

    // Independently compute what policyB should produce against a completely fresh state whose
    // hourBuckets carry none of policyA's output.
    const independentState = createInitialState("2026-07-20", "America/New_York", segments);
    const independentResult = processOvertime(independentState, policyB, ctx);

    expect(afterSecondCall.hourBuckets).toEqual(independentResult.hourBuckets);
    expect(afterSecondCall.hourBuckets).toEqual({ regularMinutes: 360, otMinutes: 240, dtMinutes: 0 });
    // Prove it's an overwrite, not an accumulation on top of policyA's leftover buckets.
    expect(afterSecondCall.hourBuckets).not.toEqual(afterFirstCall.hourBuckets);
  });
});
