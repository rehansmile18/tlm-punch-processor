import { describe, expect, it } from "vitest";
import { PipelineStep, runPipeline } from "../../src/engine/pipeline";
import { createInitialState, ProcessingContext, ProcessingState, RemotePolicy, RuleProcessor, Segment } from "../../src/engine/types";
import { PolicyType } from "../../src/types/domain";

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

function makeCtx(): Omit<ProcessingContext, "sourceAssignment"> {
  return {
    clientId: "client-1",
    employeeId: "employee-1",
    siteId: "site-1",
    task: "default",
    evaluationTz: "America/New_York",
    weekToDate: {
      workweekKey: "2026-W29",
      cumulativeRegularMinutesPriorDays: 0,
      cumulativeOtMinutesPriorDays: 0,
      consecutiveDaysWorked: 0,
    },
  };
}

function sourceAssignment(priority: number, targetType: "EMPLOYEE" | "LOCATION" = "EMPLOYEE") {
  return {
    assignmentId: `assignment-${priority}`,
    targetType,
    priority,
    ruleGroupId: "rule-group-1",
    ruleGroupVersion: 1,
  };
}

function policyOf(policyType: PolicyType, rules: any, policyId = `policy-${policyType}`): RemotePolicy {
  return { policyId, version: 1, policyType, name: `Test ${policyType}`, rules };
}

// Trivial test-double processors, keyed by REAL PolicyType values, that exercise orchestration
// behavior (ordering / state-threading) rather than any real business logic.
// RATE: sets rate.baseRate straight from policy.rules.testValue (simple counter-like assignment).
const setBaseRateFromRules: RuleProcessor = (state, policy) => ({
  ...state,
  rate: { ...state.rate, baseRate: policy.rules.testValue },
});

// OVERTIME (repurposed as a "counter" processor for this test): adds policy.rules.testValue to
// the existing baseRate, so chained calls prove each step's output feeds the next step's input.
const addToBaseRate: RuleProcessor = (state, policy) => ({
  ...state,
  rate: { ...state.rate, baseRate: state.rate.baseRate + policy.rules.testValue },
});

// SHIFT_DIFFERENTIAL: appends a violation, to exercise the "violations grew" summary branch.
const appendViolation: RuleProcessor = (state, policy) => ({
  ...state,
  violations: [
    ...state.violations,
    { policyId: policy.policyId, policyType: policy.policyType, code: "TEST", message: "test violation", severity: "warning" },
  ],
});

const testRegistry: Record<string, RuleProcessor> = {
  RATE: setBaseRateFromRules,
  OVERTIME: addToBaseRate,
  SHIFT_DIFFERENTIAL: appendViolation,
};

describe("runPipeline", () => {
  it("executes steps in the given order, threading each step's output into the next step's input", () => {
    const initialState = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const steps: PipelineStep[] = [
      { policy: policyOf("RATE", { testValue: 10 }), sourceAssignment: sourceAssignment(1, "LOCATION") },
      { policy: policyOf("OVERTIME", { testValue: 5 }), sourceAssignment: sourceAssignment(2, "EMPLOYEE") },
      { policy: policyOf("OVERTIME", { testValue: 3 }), sourceAssignment: sourceAssignment(3, "EMPLOYEE") },
    ];

    const result = runPipeline(steps, initialState, ctx, testRegistry as Record<PolicyType, RuleProcessor>);

    // 0 -> RATE sets baseRate to 10 -> OVERTIME(+5) => 15 -> OVERTIME(+3) => 18.
    expect(result.finalState.rate.baseRate).toBe(18);
    expect(result.steps).toHaveLength(3);

    // Each step's recorded outputState.rate.baseRate must match the next step's inputState.rate.baseRate.
    expect(result.steps[0].outputState.rate.baseRate).toBe(10);
    expect(result.steps[1].inputState.rate.baseRate).toBe(10);
    expect(result.steps[1].outputState.rate.baseRate).toBe(15);
    expect(result.steps[2].inputState.rate.baseRate).toBe(15);
    expect(result.steps[2].outputState.rate.baseRate).toBe(18);

    // sequenceIndex, policyId/Type/Version, and sourceAssignment must be recorded per step.
    expect(result.steps.map((s) => s.sequenceIndex)).toEqual([0, 1, 2]);
    expect(result.steps[0].policyId).toBe("policy-RATE");
    expect(result.steps[0].policyType).toBe("RATE");
    expect(result.steps[0].policyVersion).toBe(1);
    expect(result.steps[0].sourceAssignment).toEqual(sourceAssignment(1, "LOCATION"));

    // durationMs must be recorded and non-negative.
    for (const step of result.steps) {
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("captures inputState/outputState as independent deep clones (not live-state references)", () => {
    const initialState = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const steps: PipelineStep[] = [{ policy: policyOf("RATE", { testValue: 42 }), sourceAssignment: sourceAssignment(1) }];

    const result = runPipeline(steps, initialState, ctx, testRegistry as Record<PolicyType, RuleProcessor>);
    const [step] = result.steps;

    // Not the same object references as the live initialState/finalState.
    expect(step.inputState).not.toBe(initialState);
    expect(step.outputState).not.toBe(result.finalState);
    expect(step.inputState).not.toBe(step.outputState);

    // Snapshots are structurally correct at the time they were taken.
    expect(step.inputState.rate.baseRate).toBe(0);
    expect(step.outputState.rate.baseRate).toBe(42);

    // Mutating the live finalState afterward must NOT affect the previously captured snapshots
    // (proves the clone is deep, not shallow — nested objects aren't shared either).
    (result.finalState.rate as ProcessingState["rate"]).baseRate = 999;
    expect(step.outputState.rate.baseRate).toBe(42);

    // Mutating a captured snapshot must not affect the other snapshot or the live state.
    step.inputState.rate.baseRate = -1;
    expect(step.outputState.rate.baseRate).toBe(42);
    expect(result.finalState.rate.baseRate).toBe(999);
  });

  it("generates a human-readable summary describing what changed per step", () => {
    const initialState = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const steps: PipelineStep[] = [
      { policy: policyOf("RATE", { testValue: 20 }), sourceAssignment: sourceAssignment(1, "LOCATION") },
      { policy: policyOf("SHIFT_DIFFERENTIAL", {}), sourceAssignment: sourceAssignment(2, "EMPLOYEE") },
    ];

    const result = runPipeline(steps, initialState, ctx, testRegistry as Record<PolicyType, RuleProcessor>);

    expect(result.steps[0].humanReadableSummary).toContain("RATE");
    expect(result.steps[0].humanReadableSummary).toContain("LOCATION assignment, priority 1");
    expect(result.steps[1].humanReadableSummary).toContain("1 new violation(s) added");
  });

  it("says 'no change' when a step is an observable no-op", () => {
    const initialState = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const noOpProcessor: RuleProcessor = (state) => state;
    const registry: Record<string, RuleProcessor> = { ...testRegistry, PAYGROUP: noOpProcessor };

    const steps: PipelineStep[] = [{ policy: policyOf("PAYGROUP", {}), sourceAssignment: sourceAssignment(1) }];

    const result = runPipeline(steps, initialState, ctx, registry as Record<PolicyType, RuleProcessor>);

    expect(result.steps[0].humanReadableSummary).toContain("no change");
  });

  it("throws immediately when a policyType has no registered processor", () => {
    const initialState = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const steps: PipelineStep[] = [
      { policy: policyOf("MEAL_BREAK", { testValue: 1 }), sourceAssignment: sourceAssignment(1) },
    ];

    expect(() => runPipeline(steps, initialState, ctx, testRegistry as Record<PolicyType, RuleProcessor>)).toThrow(
      /MEAL_BREAK/
    );
  });

  it("returns an empty steps array and the untouched initial state when given no steps", () => {
    const initialState = createInitialState("2026-07-20", "America/New_York", makeSegments());
    const ctx = makeCtx();

    const result = runPipeline([], initialState, ctx, testRegistry as Record<PolicyType, RuleProcessor>);

    expect(result.steps).toEqual([]);
    expect(result.finalState).toBe(initialState);
  });
});
