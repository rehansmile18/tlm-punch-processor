import { describe, it, expect } from "vitest";
import { createInitialState, ProcessingContext, RemotePolicy, Segment } from "../../src/engine/types";
import { processRestBreak } from "../../src/engine/processors/restBreak";

function makeSegment(startIso: string, endIso: string): Segment {
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

function makePolicy(overrides: Partial<{
  paidRestBreak: boolean;
  restBreakDurationMinutes: number;
  minutesOfWorkPerRestBreak: number;
  penalty: { type: "premium_pay"; hours: number; rate: "regular" | "overtime" };
}> = {}): RemotePolicy {
  return {
    policyId: "policy-rest-break-1",
    version: 1,
    policyType: "REST_BREAK",
    name: "Standard Rest Break",
    rules: {
      paidRestBreak: true,
      restBreakDurationMinutes: 10,
      minutesOfWorkPerRestBreak: 240,
      penalty: { type: "premium_pay", hours: 1, rate: "regular" },
      ...overrides,
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
      priority: 0,
      ruleGroupId: "rule-group-1",
      ruleGroupVersion: 1,
    },
    weekToDate: {
      workweekKey: "2026-W30",
      cumulativeRegularMinutesPriorDays: 0,
      cumulativeOtMinutesPriorDays: 0,
      consecutiveDaysWorked: 0,
    },
  };
}

describe("processRestBreak", () => {
  it("adds no violation when the shift is shorter than minutesOfWorkPerRestBreak", () => {
    // 2 hour shift, threshold is 4 hours (240 minutes) — no break required.
    const segments = [makeSegment("2026-07-20T09:00:00.000Z", "2026-07-20T11:00:00.000Z")];
    const state = createInitialState("2026-07-20", "America/New_York", segments);
    const policy = makePolicy({ minutesOfWorkPerRestBreak: 240 });
    const ctx = makeCtx();

    const result = processRestBreak(state, policy, ctx);

    expect(result.violations).toEqual([]);
    expect(result.workSegments).toBe(state.workSegments);
    expect(result.hourBuckets).toBe(state.hourBuckets);
    expect(result.penalties).toBe(state.penalties);
  });

  it("adds exactly one violation with correct count for a shift qualifying for exactly 1 break", () => {
    // 4 hour shift (240 minutes), threshold 240 minutes -> exactly 1 required break.
    const segments = [makeSegment("2026-07-20T09:00:00.000Z", "2026-07-20T13:00:00.000Z")];
    const state = createInitialState("2026-07-20", "America/New_York", segments);
    const policy = makePolicy({ minutesOfWorkPerRestBreak: 240, restBreakDurationMinutes: 10, penalty: { type: "premium_pay", hours: 1, rate: "regular" } });
    const ctx = makeCtx();

    const result = processRestBreak(state, policy, ctx);

    expect(result.violations).toHaveLength(1);
    const violation = result.violations[0];
    expect(violation.code).toBe("rest_break_review_required");
    expect(violation.severity).toBe("warning");
    expect(violation.policyId).toBe(policy.policyId);
    expect(violation.policyType).toBe(policy.policyType);
    expect(violation.message).toContain("1 rest break(s)");
    expect(violation.message).toContain("10min each");
    expect(violation.message).toContain("1h regular penalty");

    // workSegments/hourBuckets/penalties completely unchanged.
    expect(result.workSegments).toBe(state.workSegments);
    expect(result.hourBuckets).toBe(state.hourBuckets);
    expect(result.penalties).toBe(state.penalties);
    expect(result.penalties).toEqual([]);
  });

  it("reflects the correct count for a shift qualifying for 2+ required breaks", () => {
    // 9 hour shift (540 minutes), threshold 240 minutes -> floor(540/240) = 2 required breaks.
    const segments = [makeSegment("2026-07-20T09:00:00.000Z", "2026-07-20T18:00:00.000Z")];
    const state = createInitialState("2026-07-20", "America/New_York", segments);
    const policy = makePolicy({ minutesOfWorkPerRestBreak: 240, restBreakDurationMinutes: 10 });
    const ctx = makeCtx();

    const result = processRestBreak(state, policy, ctx);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].message).toContain("2 rest break(s)");

    expect(result.workSegments).toBe(state.workSegments);
    expect(result.hourBuckets).toBe(state.hourBuckets);
    expect(result.penalties).toBe(state.penalties);
  });

  it("sums minutes across multiple raw segments", () => {
    // Two segments of 150 minutes each = 300 total minutes, threshold 240 -> 1 required break.
    const segments = [
      makeSegment("2026-07-20T09:00:00.000Z", "2026-07-20T11:30:00.000Z"),
      makeSegment("2026-07-20T12:00:00.000Z", "2026-07-20T14:30:00.000Z"),
    ];
    const state = createInitialState("2026-07-20", "America/New_York", segments);
    const policy = makePolicy({ minutesOfWorkPerRestBreak: 240 });
    const ctx = makeCtx();

    const result = processRestBreak(state, policy, ctx);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].message).toContain("1 rest break(s)");
  });
});
