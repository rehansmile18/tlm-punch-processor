import { describe, expect, it } from "vitest";
import { processRate } from "../../src/engine/processors/rate";
import { createInitialState, ProcessingContext, RemotePolicy, Segment } from "../../src/engine/types";

function makeSegments(): Segment[] {
  return [
    {
      startIso: "2026-07-20T09:00:00.000Z",
      endIso: "2026-07-20T17:00:00.000Z",
      sourcePunchIds: ["punch-1"],
      siteId: "site-1",
      task: "default",
      paid: true,
      createdByPolicyId: null,
    },
  ];
}

function makeRatePolicy(minimumWage: number, rateType: "hourly" | "salary" = "hourly"): RemotePolicy {
  return {
    policyId: "policy-rate-1",
    version: 1,
    policyType: "RATE",
    name: "Test Rate Policy",
    rules: {
      rateType,
      minimumWage,
      minimumWageSource: "federal",
    },
  };
}

function makeCtx(): ProcessingContext {
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
      consecutiveDaysWorked: 0,
    },
  };
}

describe("processRate", () => {
  it("sets minimumWage/baseRate/rateType correctly from an initial zero state", () => {
    const state = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const policy = makeRatePolicy(15, "hourly");
    const ctx = makeCtx();

    const result = processRate(state, policy, ctx);

    expect(result.rate).toEqual({ rateType: "hourly", baseRate: 15, minimumWage: 15 });
    // Original state must not be mutated.
    expect(state.rate).toEqual({ rateType: "hourly", baseRate: 0, minimumWage: 0 });
  });

  it("does NOT decrease minimumWage when a second, lower-minimumWage RATE policy runs (extremal/running-max)", () => {
    const state = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const afterFirst = processRate(state, makeRatePolicy(20, "hourly"), ctx);
    expect(afterFirst.rate.minimumWage).toBe(20);

    const afterSecondLower = processRate(afterFirst, makeRatePolicy(12, "hourly"), ctx);

    // The running max must NOT be undercut by a narrower/later layer with a lower statutory floor.
    expect(afterSecondLower.rate.minimumWage).toBe(20);
    // baseRate must also never be undercut below the still-standing floor.
    expect(afterSecondLower.rate.baseRate).toBe(20);
  });

  it("DOES increase minimumWage when a second RATE policy has a higher minimumWage", () => {
    const state = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const afterFirst = processRate(state, makeRatePolicy(12, "hourly"), ctx);
    expect(afterFirst.rate.minimumWage).toBe(12);

    const afterSecondHigher = processRate(afterFirst, makeRatePolicy(20, "hourly"), ctx);

    expect(afterSecondHigher.rate.minimumWage).toBe(20);
    expect(afterSecondHigher.rate.baseRate).toBe(20);
  });

  it("sets rateType to the latest policy's rateType (last-write-wins, not extremal)", () => {
    const state = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const afterHourly = processRate(state, makeRatePolicy(15, "hourly"), ctx);
    expect(afterHourly.rate.rateType).toBe("hourly");

    const afterSalary = processRate(afterHourly, makeRatePolicy(10, "salary"), ctx);
    expect(afterSalary.rate.rateType).toBe("salary");
    // minimumWage floor still holds even though this later call's own minimumWage is lower.
    expect(afterSalary.rate.minimumWage).toBe(15);
  });

  it("returns a new state object rather than mutating the input", () => {
    const state = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const policy = makeRatePolicy(15, "hourly");
    const ctx = makeCtx();

    const result = processRate(state, policy, ctx);

    expect(result).not.toBe(state);
    expect(result.rate).not.toBe(state.rate);
  });
});
