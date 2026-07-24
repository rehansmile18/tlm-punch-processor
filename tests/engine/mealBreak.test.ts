import { describe, it, expect } from "vitest";
import { createInitialState, ProcessingContext, RemotePolicy, Segment } from "../../src/engine/types";
import { processMealBreak } from "../../src/engine/processors/mealBreak";

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

function makePolicy(overrides: Partial<{
  minShiftLengthForMealMinutes: number;
  mealDurationMinMinutes: number;
  paidMeal: boolean;
  waiverAllowed: boolean;
}> = {}): RemotePolicy {
  return {
    policyId: "policy-meal-1",
    version: 1,
    policyType: "MEAL_BREAK",
    name: "Standard Meal Break",
    rules: {
      minShiftLengthForMealMinutes: 360, // 6h
      mealDurationMinMinutes: 30,
      paidMeal: false,
      waiverAllowed: true,
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

describe("processMealBreak", () => {
  it("does not deduct when the shift is under the minimum length", () => {
    // 4 hour shift, under the 6h (360min) threshold.
    const rawSegments = [seg("2026-07-20T09:00:00.000Z", "2026-07-20T13:00:00.000Z")];
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy();

    const result = processMealBreak(state, policy, ctx);

    expect(result.workSegments).toEqual(rawSegments);
    expect(totalMinutes(result.workSegments)).toBe(240);
  });

  it("does not deduct when the meal is paid, even over the minimum length", () => {
    // 8 hour shift, over threshold, but paidMeal: true.
    const rawSegments = [seg("2026-07-20T09:00:00.000Z", "2026-07-20T17:00:00.000Z")];
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy({ paidMeal: true });

    const result = processMealBreak(state, policy, ctx);

    expect(result.workSegments).toEqual(rawSegments);
    expect(totalMinutes(result.workSegments)).toBe(480);
  });

  it("deducts exactly mealDurationMinMinutes when the shift is over the minimum and unpaid", () => {
    const rawSegments = [seg("2026-07-20T09:00:00.000Z", "2026-07-20T17:00:00.000Z")];
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy({ paidMeal: false });

    const result = processMealBreak(state, policy, ctx);

    expect(paidMinutes(result.workSegments)).toBe(480 - 30);
    // The carved-out chunk should still be present, just flagged unpaid and tagged with this policy.
    const carved = result.workSegments.find((s) => s.paid === false);
    expect(carved).toBeDefined();
    expect(carved?.createdByPolicyId).toBe(policy.policyId);
    expect(totalMinutes(result.workSegments)).toBe(480); // conserved: nothing vanishes, just re-flagged.
  });

  it("does not double-deduct when the same processor is rerun on an already-deducted state", () => {
    const rawSegments = [seg("2026-07-20T09:00:00.000Z", "2026-07-20T17:00:00.000Z")];
    const state = createInitialState("2026-07-20", "America/Los_Angeles", rawSegments);
    const policy = makePolicy({ paidMeal: false });

    const once = processMealBreak(state, policy, ctx);
    const stateAfterOnce = { ...state, workSegments: once.workSegments };
    const twice = processMealBreak(stateAfterOnce, policy, ctx);

    expect(paidMinutes(twice.workSegments)).toBe(480 - 30);
    expect(totalMinutes(twice.workSegments)).toBe(480);
  });
});
