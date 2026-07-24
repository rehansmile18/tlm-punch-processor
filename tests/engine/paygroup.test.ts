import { describe, expect, it } from "vitest";
import { processPaygroup } from "../../src/engine/processors/paygroup";
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

function makePaygroupPolicy(): RemotePolicy {
  return {
    policyId: "policy-paygroup-1",
    version: 1,
    policyType: "PAYGROUP",
    name: "Test Paygroup Policy",
    rules: {
      payFrequency: "biweekly",
      workweekStart: "Sunday",
      defaultOvertimePolicyId: "policy-ot-1",
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

describe("processPaygroup", () => {
  it("is a no-op: returns a value deep-equal (and reference-equal) to the input state, regardless of policy.rules", () => {
    const state = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const policy = makePaygroupPolicy();
    const ctx = makeCtx();

    const result = processPaygroup(state, policy, ctx);

    expect(result).toBe(state); // reference-equal
    expect(result).toEqual(state); // and deep-equal, as required
  });

  it("remains a no-op even with a differently shaped/populated state and rules", () => {
    const baseState = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const state = {
      ...baseState,
      hourBuckets: { regularMinutes: 480, otMinutes: 60, dtMinutes: 0 },
      rate: { rateType: "hourly" as const, baseRate: 18, minimumWage: 15 },
    };
    const policy: RemotePolicy = {
      policyId: "policy-paygroup-2",
      version: 3,
      policyType: "PAYGROUP",
      name: "Another Paygroup Policy",
      rules: {
        payFrequency: "monthly",
        workweekStart: "Monday",
        defaultOvertimePolicyId: null,
      },
    };
    const ctx = makeCtx();

    const result = processPaygroup(state, policy, ctx);

    expect(result).toBe(state);
    expect(result).toEqual(state);
  });
});
