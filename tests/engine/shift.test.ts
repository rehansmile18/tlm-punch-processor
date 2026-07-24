import { describe, expect, it } from "vitest";
import { processShift } from "../../src/engine/processors/shift";
import { createInitialState, ProcessingContext, RemotePolicy, Segment } from "../../src/engine/types";

const BUSINESS_DATE = "2026-07-20";
const TZ = "America/New_York";

function makeSegment(startIso: string, endIso: string, overrides: Partial<Segment> = {}): Segment {
  return {
    startIso,
    endIso,
    sourcePunchIds: ["punch-1"],
    siteId: "site-1",
    task: "default",
    paid: true,
    createdByPolicyId: null,
    ...overrides,
  };
}

function makePolicy(rulesOverrides: Partial<RemotePolicy["rules"]> = {}): RemotePolicy {
  return {
    policyId: "policy-shift-1",
    version: 1,
    policyType: "SHIFT",
    name: "Standard Shift Policy",
    rules: {
      minShiftLengthHours: 3,
      maxShiftLengthHours: 10,
      minRestBetweenShiftsHours: 8,
      splitShiftPremium: { enabled: false, hours: 1 },
      ...rulesOverrides,
    },
  };
}

function makeCtx(): ProcessingContext {
  return {
    clientId: "client-1",
    employeeId: "employee-1",
    siteId: "site-1",
    task: "default",
    evaluationTz: TZ,
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
      consecutiveDaysWorked: 0,
    },
  };
}

describe("processShift", () => {
  it("produces no violations or penalties for a shift within bounds with no gaps", () => {
    const segments = [makeSegment("2026-07-20T09:00:00.000Z", "2026-07-20T15:00:00.000Z")]; // 6h
    const state = createInitialState(BUSINESS_DATE, TZ, segments);
    const policy = makePolicy();
    const ctx = makeCtx();

    const result = processShift(state, policy, ctx);

    expect(result.violations).toEqual([]);
    expect(result.penalties).toEqual([]);
  });

  it("appends a shift_too_short warning violation when total hours is below the minimum", () => {
    const segments = [makeSegment("2026-07-20T09:00:00.000Z", "2026-07-20T10:30:00.000Z")]; // 1.5h
    const state = createInitialState(BUSINESS_DATE, TZ, segments);
    const policy = makePolicy({ minShiftLengthHours: 3 });
    const ctx = makeCtx();

    const result = processShift(state, policy, ctx);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      code: "shift_too_short",
      severity: "warning",
      policyId: "policy-shift-1",
      policyType: "SHIFT",
    });
    expect(result.penalties).toEqual([]);
  });

  it("appends a shift_too_long review_required violation when total hours exceeds the maximum", () => {
    const segments = [makeSegment("2026-07-20T08:00:00.000Z", "2026-07-20T20:00:00.000Z")]; // 12h
    const state = createInitialState(BUSINESS_DATE, TZ, segments);
    const policy = makePolicy({ maxShiftLengthHours: 10 });
    const ctx = makeCtx();

    const result = processShift(state, policy, ctx);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      code: "shift_too_long",
      severity: "review_required",
      policyId: "policy-shift-1",
      policyType: "SHIFT",
    });
    expect(result.penalties).toEqual([]);
  });

  it("appends a premium_pay penalty when a >1hr gap exists and splitShiftPremium is enabled", () => {
    const segments = [
      makeSegment("2026-07-20T08:00:00.000Z", "2026-07-20T11:00:00.000Z"),
      makeSegment("2026-07-20T13:30:00.000Z", "2026-07-20T17:00:00.000Z"), // 2.5h gap
    ];
    const state = createInitialState(BUSINESS_DATE, TZ, segments);
    const policy = makePolicy({ splitShiftPremium: { enabled: true, hours: 1.5 } });
    const ctx = makeCtx();

    const result = processShift(state, policy, ctx);

    expect(result.penalties).toHaveLength(1);
    expect(result.penalties[0]).toMatchObject({
      type: "premium_pay",
      hours: 1.5,
      rate: "regular",
      reason: "split shift premium",
      policyId: "policy-shift-1",
      policyType: "SHIFT",
    });
  });

  it("does not append a penalty for the same gap when splitShiftPremium is disabled", () => {
    const segments = [
      makeSegment("2026-07-20T08:00:00.000Z", "2026-07-20T11:00:00.000Z"),
      makeSegment("2026-07-20T13:30:00.000Z", "2026-07-20T17:00:00.000Z"), // 2.5h gap
    ];
    const state = createInitialState(BUSINESS_DATE, TZ, segments);
    const policy = makePolicy({ splitShiftPremium: { enabled: false, hours: 1.5 } });
    const ctx = makeCtx();

    const result = processShift(state, policy, ctx);

    expect(result.penalties).toEqual([]);
  });

  it("does not treat a small 10-minute gap as a split shift", () => {
    const segments = [
      makeSegment("2026-07-20T08:00:00.000Z", "2026-07-20T11:00:00.000Z"),
      makeSegment("2026-07-20T11:10:00.000Z", "2026-07-20T15:00:00.000Z"), // 10 minute gap
    ];
    const state = createInitialState(BUSINESS_DATE, TZ, segments);
    const policy = makePolicy({ splitShiftPremium: { enabled: true, hours: 1 } });
    const ctx = makeCtx();

    const result = processShift(state, policy, ctx);

    expect(result.penalties).toEqual([]);
    expect(result.violations).toEqual([]);
  });
});
