import { describe, expect, it } from "vitest";
import { createInitialState, ProcessingContext, RemotePolicy, Segment } from "../../src/engine/types";
import { processNightDifferential, processShiftDifferential } from "../../src/engine/processors/shiftDifferential";

function makeSegment(startIso: string, endIso: string, punchId = "p1"): Segment {
  return {
    startIso,
    endIso,
    sourcePunchIds: [punchId],
    siteId: "site-1",
    task: "task-1",
    paid: true,
    createdByPolicyId: null,
  };
}

function makeContext(): ProcessingContext {
  return {
    clientId: "client-1",
    employeeId: "employee-1",
    siteId: "site-1",
    task: "task-1",
    evaluationTz: "UTC",
    sourceAssignment: {
      assignmentId: "assignment-1",
      targetType: "EMPLOYEE",
      priority: 1,
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

function makePolicy(
  policyType: "SHIFT_DIFFERENTIAL" | "NIGHT_DIFFERENTIAL",
  timeBands: Array<{ start: string; end: string; differentialType: "percent" | "flat"; value: number }>,
  policyId = "policy-1"
): RemotePolicy {
  return {
    policyId,
    version: 1,
    policyType,
    name: `${policyType} test policy`,
    rules: { timeBands },
  };
}

describe("processShiftDifferential / processNightDifferential (shared time-band factory)", () => {
  it("computes full overlap for a segment entirely within a same-day band", () => {
    const state = createInitialState("2026-07-21", "UTC", [
      makeSegment("2026-07-21T19:00:00.000Z", "2026-07-21T21:00:00.000Z"),
    ]);
    const policy = makePolicy("SHIFT_DIFFERENTIAL", [{ start: "18:00", end: "22:00", differentialType: "percent", value: 10 }]);

    const result = processShiftDifferential(state, policy, makeContext());

    expect(result.differentialApplications).toHaveLength(1);
    expect(result.differentialApplications[0]).toMatchObject({
      policyId: "policy-1",
      policyType: "SHIFT_DIFFERENTIAL",
      band: { start: "18:00", end: "22:00" },
      minutesAffected: 120,
      differentialType: "percent",
      value: 10,
    });
    expect(result.differentialApplications[0].appliesToSegmentRefs).toEqual(["p1"]);
    // Processor must not mutate workSegments/hourBuckets, and must not mutate state in place.
    expect(result.workSegments).toBe(state.workSegments);
    expect(result.hourBuckets).toBe(state.hourBuckets);
    expect(result).not.toBe(state);
  });

  it("computes partial overlap for a segment straddling the band boundary", () => {
    const state = createInitialState("2026-07-21", "UTC", [
      makeSegment("2026-07-21T21:00:00.000Z", "2026-07-21T23:00:00.000Z"),
    ]);
    const policy = makePolicy("SHIFT_DIFFERENTIAL", [{ start: "18:00", end: "22:00", differentialType: "flat", value: 2 }]);

    const result = processShiftDifferential(state, policy, makeContext());

    expect(result.differentialApplications).toHaveLength(1);
    expect(result.differentialApplications[0].minutesAffected).toBe(60);
  });

  it("computes correct total overlap for a midnight-wrapping band against a segment that itself crosses midnight", () => {
    const state = createInitialState("2026-07-21", "UTC", [
      makeSegment("2026-07-21T23:00:00.000Z", "2026-07-22T02:00:00.000Z"),
    ]);
    const policy = makePolicy("NIGHT_DIFFERENTIAL", [{ start: "22:00", end: "06:00", differentialType: "percent", value: 15 }]);

    const result = processNightDifferential(state, policy, makeContext());

    expect(result.differentialApplications).toHaveLength(1);
    // The whole 3-hour segment (23:00 -> 02:00) falls inside the wrapped 22:00-06:00 band.
    expect(result.differentialApplications[0].minutesAffected).toBe(180);
    expect(result.differentialApplications[0].band).toEqual({ start: "22:00", end: "06:00" });
  });

  it("stacks entries from different policyTypes claiming overlapping minutes on the same segment", () => {
    const baseState = createInitialState("2026-07-21", "UTC", [
      makeSegment("2026-07-21T23:00:00.000Z", "2026-07-22T02:00:00.000Z"),
    ]);
    const shiftPolicy = makePolicy(
      "SHIFT_DIFFERENTIAL",
      [{ start: "18:00", end: "24:00", differentialType: "percent", value: 10 }],
      "shift-policy"
    );
    const nightPolicy = makePolicy(
      "NIGHT_DIFFERENTIAL",
      [{ start: "22:00", end: "06:00", differentialType: "percent", value: 15 }],
      "night-policy"
    );

    const afterShift = processShiftDifferential(baseState, shiftPolicy, makeContext());
    const afterNight = processNightDifferential(afterShift, nightPolicy, makeContext());

    expect(afterNight.differentialApplications).toHaveLength(2);
    const policyTypes = afterNight.differentialApplications.map((a) => a.policyType).sort();
    expect(policyTypes).toEqual(["NIGHT_DIFFERENTIAL", "SHIFT_DIFFERENTIAL"]);
  });

  it("dedups same policyType + same band across two runs, keeping only the later run's value", () => {
    const state = createInitialState("2026-07-21", "UTC", [
      makeSegment("2026-07-21T19:00:00.000Z", "2026-07-21T21:00:00.000Z"),
    ]);
    const firstLayerPolicy = makePolicy(
      "SHIFT_DIFFERENTIAL",
      [{ start: "18:00", end: "22:00", differentialType: "percent", value: 10 }],
      "layer-1"
    );
    const secondLayerPolicy = makePolicy(
      "SHIFT_DIFFERENTIAL",
      [{ start: "18:00", end: "22:00", differentialType: "percent", value: 25 }],
      "layer-2"
    );

    const afterFirst = processShiftDifferential(state, firstLayerPolicy, makeContext());
    const afterSecond = processShiftDifferential(afterFirst, secondLayerPolicy, makeContext());

    expect(afterSecond.differentialApplications).toHaveLength(1);
    expect(afterSecond.differentialApplications[0]).toMatchObject({
      policyId: "layer-2",
      value: 25,
    });
  });

  it("appends (does not dedup) same policyType applications for different bands", () => {
    const ctx = makeContext();
    const stateA = createInitialState("2026-07-21", "UTC", [
      makeSegment("2026-07-21T19:00:00.000Z", "2026-07-21T21:00:00.000Z"),
    ]);
    const policyBandA = makePolicy(
      "SHIFT_DIFFERENTIAL",
      [{ start: "18:00", end: "22:00", differentialType: "percent", value: 10 }],
      "policy-a"
    );
    const afterA = processShiftDifferential(stateA, policyBandA, ctx);

    const stateB = { ...afterA, workSegments: [makeSegment("2026-07-21T07:00:00.000Z", "2026-07-21T08:00:00.000Z")] };
    const policyBandB = makePolicy(
      "SHIFT_DIFFERENTIAL",
      [{ start: "06:00", end: "10:00", differentialType: "percent", value: 5 }],
      "policy-b"
    );
    const afterB = processShiftDifferential(stateB, policyBandB, ctx);

    expect(afterB.differentialApplications).toHaveLength(2);
    const bands = afterB.differentialApplications.map((a) => a.band);
    expect(bands).toEqual(
      expect.arrayContaining([
        { start: "18:00", end: "22:00" },
        { start: "06:00", end: "10:00" },
      ])
    );
  });

  it("produces no application when a band has zero overlap with any segment", () => {
    const state = createInitialState("2026-07-21", "UTC", [
      makeSegment("2026-07-21T09:00:00.000Z", "2026-07-21T10:00:00.000Z"),
    ]);
    const policy = makePolicy("SHIFT_DIFFERENTIAL", [{ start: "18:00", end: "22:00", differentialType: "percent", value: 10 }]);

    const result = processShiftDifferential(state, policy, makeContext());

    expect(result.differentialApplications).toHaveLength(0);
  });
});
