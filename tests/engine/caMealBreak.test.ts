import { describe, it, expect } from "vitest";
import { createInitialState, ProcessingContext, RemotePolicy, Segment } from "../../src/engine/types";
import { processCaMealBreak } from "../../src/engine/processors/caMealBreak";

function seg(startIso: string, endIso: string, overrides: Partial<Segment> = {}): Segment {
  return {
    startIso,
    endIso,
    sourcePunchIds: ["punch-1"],
    siteId: "site-1",
    task: "task-1",
    paid: true,
    createdByPolicyId: null,
    ...overrides,
  };
}

function totalMinutes(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + (new Date(s.endIso).getTime() - new Date(s.startIso).getTime()) / 60000, 0);
}

function paidMinutes(segments: Segment[]): number {
  return segments
    .filter((s) => s.paid !== false)
    .reduce((sum, s) => sum + (new Date(s.endIso).getTime() - new Date(s.startIso).getTime()) / 60000, 0);
}

function shiftOfMinutes(minutes: number): Segment[] {
  const start = "2026-07-20T09:00:00.000Z";
  const end = new Date(new Date(start).getTime() + minutes * 60000).toISOString();
  return [seg(start, end)];
}

function makePolicy(overrides: Partial<{
  minShiftLengthForFirstMealMinutes: number;
  mealDurationMinMinutes: number;
  mealMustStartByHourIntoShift: number;
  waiverAllowedUnderShiftHours: number;
  secondMealRequiredOverShiftHours: number;
  onDutyMealAllowed: boolean;
  penalty: { type: "premium_pay"; hours: number; rate: "regular" | "overtime" };
}> = {}): RemotePolicy {
  return {
    policyId: "policy-ca-meal-1",
    version: 1,
    policyType: "CA_MEAL_BREAK",
    name: "CA Meal Break",
    rules: {
      minShiftLengthForFirstMealMinutes: 300, // 5h
      mealDurationMinMinutes: 30,
      mealMustStartByHourIntoShift: 5,
      waiverAllowedUnderShiftHours: 12,
      secondMealRequiredOverShiftHours: 10,
      onDutyMealAllowed: false,
      penalty: { type: "premium_pay", hours: 1, rate: "regular" },
      ...overrides,
    },
  };
}

const ctx: ProcessingContext = {
  clientId: "client-1",
  employeeId: "employee-1",
  siteId: "site-1",
  task: "task-1",
  evaluationTz: "America/Los_Angeles",
  sourceAssignment: {
    assignmentId: "assignment-1",
    targetType: "EMPLOYEE",
    priority: 0,
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

describe("processCaMealBreak", () => {
  it("does not deduct when the shift is under the minimum length", () => {
    const rawSegments = shiftOfMinutes(240); // 4h, under the 5h (300min) threshold
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy();

    const result = processCaMealBreak(state, policy, ctx);

    expect(result.workSegments).toEqual(rawSegments);
    expect(result.violations).toEqual([]);
    expect(result.penalties).toEqual([]);
  });

  it("does not deduct when onDutyMealAllowed is true, even over the minimum length", () => {
    const rawSegments = shiftOfMinutes(480); // 8h, over threshold
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy({ onDutyMealAllowed: true });

    const result = processCaMealBreak(state, policy, ctx);

    expect(result.workSegments).toEqual(rawSegments);
    expect(result.violations).toEqual([]);
    expect(result.penalties).toEqual([]);
  });

  it("deducts exactly one mealDurationMinMinutes for a shift over minimum but under the second-meal threshold", () => {
    const rawSegments = shiftOfMinutes(480); // 8h: over 5h min, under 10h second-meal threshold
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy();

    const result = processCaMealBreak(state, policy, ctx);

    expect(paidMinutes(result.workSegments)).toBe(480 - 30);
    expect(totalMinutes(result.workSegments)).toBe(480);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].code).toBe("CA_MEAL_DEDUCTION_UNCONFIRMED");
    expect(result.violations[0].severity).toBe("warning");
    expect(result.penalties).toEqual([]);
  });

  it("does not double-deduct when the same processor is rerun on an already-deducted state", () => {
    const rawSegments = shiftOfMinutes(480);
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy();

    const once = processCaMealBreak(state, policy, ctx);
    const stateAfterOnce = { ...state, workSegments: once.workSegments, violations: once.violations };
    const twice = processCaMealBreak(stateAfterOnce, policy, ctx);

    expect(paidMinutes(twice.workSegments)).toBe(480 - 30);
    expect(totalMinutes(twice.workSegments)).toBe(480);
    expect(twice.penalties).toEqual([]);
  });

  it("deducts 2x mealDurationMinMinutes and flags a violation for a shift long enough to require a second meal (outside waiver range)", () => {
    const rawSegments = shiftOfMinutes(780); // 13h: over 10h second-meal threshold AND over 12h waiver-eligible range
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy();

    const result = processCaMealBreak(state, policy, ctx);

    expect(paidMinutes(result.workSegments)).toBe(780 - 60);
    expect(totalMinutes(result.workSegments)).toBe(780);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].code).toBe("CA_SECOND_MEAL_REQUIRED");
    expect(result.violations[0].severity).toBe("warning");
    expect(result.penalties).toEqual([]);
  });

  it("deducts only the base meal and flags a violation for a shift within the waiver range", () => {
    const rawSegments = shiftOfMinutes(660); // 11h: over 10h second-meal threshold but under 12h waiver range
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy();

    const result = processCaMealBreak(state, policy, ctx);

    expect(paidMinutes(result.workSegments)).toBe(660 - 30);
    expect(totalMinutes(result.workSegments)).toBe(660);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].code).toBe("CA_SECOND_MEAL_WAIVER_UNCONFIRMED");
    expect(result.violations[0].severity).toBe("warning");
    expect(result.penalties).toEqual([]);
  });
});
