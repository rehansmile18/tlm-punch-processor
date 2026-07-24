import { describe, it, expect } from "vitest";
import { createInitialState, ProcessingContext, RemotePolicy, Segment } from "../../src/engine/types";
import { processPayDifferential } from "../../src/engine/processors/payDifferential";

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    startIso: "2026-07-21T09:00:00.000Z",
    endIso: "2026-07-21T17:00:00.000Z", // 8 hours = 480 minutes
    sourcePunchIds: ["punch-1"],
    siteId: "site-1",
    task: "forklift",
    paid: true,
    createdByPolicyId: null,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ProcessingContext> = {}): ProcessingContext {
  return {
    clientId: "client-1",
    employeeId: "employee-1",
    siteId: "site-1",
    task: "forklift",
    evaluationTz: "America/Chicago",
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
    ...overrides,
  };
}

function makePolicy(conditions: Array<{ type: string; code: string; differentialType: "percent" | "flat"; value: number }>): RemotePolicy {
  return {
    policyId: "policy-pay-diff-1",
    version: 1,
    policyType: "PAY_DIFFERENTIAL",
    name: "Forklift Differential",
    rules: { conditions },
  };
}

describe("processPayDifferential", () => {
  it("appends one DifferentialApplication when the task matches exactly one condition", () => {
    const segments = [makeSegment()];
    const state = createInitialState("2026-07-21", "America/Chicago", segments);
    const policy = makePolicy([{ type: "TASK", code: "forklift", differentialType: "flat", value: 1.5 }]);
    const ctx = makeCtx({ task: "forklift" });

    const result = processPayDifferential(state, policy, ctx);

    expect(result.differentialApplications).toHaveLength(1);
    expect(result.differentialApplications[0]).toEqual({
      policyId: "policy-pay-diff-1",
      policyType: "PAY_DIFFERENTIAL",
      band: { conditionCode: "forklift" },
      minutesAffected: 480,
      differentialType: "flat",
      value: 1.5,
      appliesToSegmentRefs: [],
    });
  });

  it("appends nothing when the task matches no conditions, leaving prior entries untouched", () => {
    const segments = [makeSegment()];
    const state = createInitialState("2026-07-21", "America/Chicago", segments);
    const priorEntry = {
      policyId: "some-other-policy",
      policyType: "PAY_DIFFERENTIAL" as const,
      band: { conditionCode: "hazmat" },
      minutesAffected: 60,
      differentialType: "flat" as const,
      value: 2,
      appliesToSegmentRefs: [],
    };
    const stateWithPrior = { ...state, differentialApplications: [priorEntry] };
    const policy = makePolicy([{ type: "TASK", code: "welding", differentialType: "percent", value: 10 }]);
    const ctx = makeCtx({ task: "forklift" });

    const result = processPayDifferential(stateWithPrior, policy, ctx);

    expect(result.differentialApplications).toEqual([priorEntry]);
    expect(result.differentialApplications).toHaveLength(1);
  });

  it("appends two entries when the task matches two different conditions in the same policy", () => {
    const segments = [makeSegment()];
    const state = createInitialState("2026-07-21", "America/Chicago", segments);
    const policy = makePolicy([
      { type: "TASK", code: "forklift", differentialType: "flat", value: 1.5 },
      { type: "HAZARD", code: "forklift", differentialType: "percent", value: 5 },
    ]);
    const ctx = makeCtx({ task: "forklift" });

    const result = processPayDifferential(state, policy, ctx);

    expect(result.differentialApplications).toHaveLength(2);
    expect(result.differentialApplications).toEqual([
      {
        policyId: "policy-pay-diff-1",
        policyType: "PAY_DIFFERENTIAL",
        band: { conditionCode: "forklift" },
        minutesAffected: 480,
        differentialType: "flat",
        value: 1.5,
        appliesToSegmentRefs: [],
      },
      {
        policyId: "policy-pay-diff-1",
        policyType: "PAY_DIFFERENTIAL",
        band: { conditionCode: "forklift" },
        minutesAffected: 480,
        differentialType: "percent",
        value: 5,
        appliesToSegmentRefs: [],
      },
    ]);
  });

  it("leaves workSegments and hourBuckets unchanged", () => {
    const segments = [makeSegment()];
    const state = createInitialState("2026-07-21", "America/Chicago", segments);
    const policy = makePolicy([{ type: "TASK", code: "forklift", differentialType: "flat", value: 1.5 }]);
    const ctx = makeCtx({ task: "forklift" });

    const result = processPayDifferential(state, policy, ctx);

    expect(result.workSegments).toBe(state.workSegments);
    expect(result.hourBuckets).toEqual({ regularMinutes: 0, otMinutes: 0, dtMinutes: 0 });
    expect(result.hourBuckets).toBe(state.hourBuckets);
  });

  it("performs an exact case-sensitive match on condition code vs ctx.task", () => {
    const segments = [makeSegment()];
    const state = createInitialState("2026-07-21", "America/Chicago", segments);
    const policy = makePolicy([{ type: "TASK", code: "Forklift", differentialType: "flat", value: 1.5 }]);
    const ctx = makeCtx({ task: "forklift" });

    const result = processPayDifferential(state, policy, ctx);

    expect(result.differentialApplications).toHaveLength(0);
    expect(result).toBe(state);
  });
});
