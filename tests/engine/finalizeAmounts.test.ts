import { describe, expect, it } from "vitest";
import { finalizeAmounts } from "../../src/engine/finalizeAmounts";
import { createInitialState, DifferentialApplication, Penalty, ProcessingState, Segment } from "../../src/engine/types";

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

function baseState(overrides: Partial<ProcessingState> = {}): ProcessingState {
  const state = createInitialState("2026-07-20", "America/New_York", makeSegments());
  return { ...state, ...overrides };
}

describe("finalizeAmounts", () => {
  it("computes regularAmount correctly from regular hours only; everything else is 0", () => {
    const state = baseState({
      hourBuckets: { regularMinutes: 480, otMinutes: 0, dtMinutes: 0 }, // 8h
      rate: { rateType: "hourly", baseRate: 20, minimumWage: 15 },
    });

    const result = finalizeAmounts(state);

    expect(result.regularAmount).toBe(160); // 8h * $20
    expect(result.otAmount).toBe(0);
    expect(result.dtAmount).toBe(0);
    expect(result.differentialAmount).toBe(0);
    expect(result.premiumAmount).toBe(0);
    expect(result.totalAmount).toBe(160);
  });

  it("computes otAmount at 1.5x baseRate", () => {
    const state = baseState({
      hourBuckets: { regularMinutes: 0, otMinutes: 120, dtMinutes: 0 }, // 2h OT
      rate: { rateType: "hourly", baseRate: 10, minimumWage: 10 },
    });

    const result = finalizeAmounts(state);

    expect(result.otAmount).toBe(30); // 2h * $10 * 1.5
  });

  it("computes dtAmount at 2x baseRate", () => {
    const state = baseState({
      hourBuckets: { regularMinutes: 0, otMinutes: 0, dtMinutes: 60 }, // 1h DT
      rate: { rateType: "hourly", baseRate: 10, minimumWage: 10 },
    });

    const result = finalizeAmounts(state);

    expect(result.dtAmount).toBe(20); // 1h * $10 * 2
  });

  it("adds a flat differential's value directly, regardless of minutesAffected", () => {
    const differential: DifferentialApplication = {
      policyId: "policy-diff-1",
      policyType: "SHIFT_DIFFERENTIAL",
      band: { start: "22:00", end: "06:00" },
      minutesAffected: 999, // deliberately irrelevant for a flat differential
      differentialType: "flat",
      value: 25,
      appliesToSegmentRefs: [],
    };
    const state = baseState({
      differentialApplications: [differential],
      rate: { rateType: "hourly", baseRate: 10, minimumWage: 10 },
    });

    const result = finalizeAmounts(state);

    expect(result.differentialAmount).toBe(25);
  });

  it("scales a percent differential by minutesAffected/60 * baseRate * pct", () => {
    const differential: DifferentialApplication = {
      policyId: "policy-diff-2",
      policyType: "NIGHT_DIFFERENTIAL",
      band: { start: "22:00", end: "06:00" },
      minutesAffected: 120, // 2h
      differentialType: "percent",
      value: 10, // 10%
      appliesToSegmentRefs: [],
    };
    const state = baseState({
      differentialApplications: [differential],
      rate: { rateType: "hourly", baseRate: 20, minimumWage: 15 },
    });

    const result = finalizeAmounts(state);

    expect(result.differentialAmount).toBe(4); // 2h * $20 * 0.10
  });

  it("computes a premium at 'overtime' rate at 1.5x baseRate", () => {
    const penalty: Penalty = {
      policyId: "policy-penalty-1",
      policyType: "MEAL_BREAK",
      type: "premium_pay",
      hours: 1,
      rate: "overtime",
      reason: "missed meal break",
    };
    const state = baseState({
      penalties: [penalty],
      rate: { rateType: "hourly", baseRate: 20, minimumWage: 15 },
    });

    const result = finalizeAmounts(state);

    expect(result.premiumAmount).toBe(30); // 1h * $20 * 1.5
  });

  it("computes a premium at 'regular' rate at 1x baseRate", () => {
    const penalty: Penalty = {
      policyId: "policy-penalty-2",
      policyType: "REST_BREAK",
      type: "premium_pay",
      hours: 1,
      rate: "regular",
      reason: "missed rest break",
    };
    const state = baseState({
      penalties: [penalty],
      rate: { rateType: "hourly", baseRate: 20, minimumWage: 15 },
    });

    const result = finalizeAmounts(state);

    expect(result.premiumAmount).toBe(20); // 1h * $20 * 1
  });

  it("sums all five components correctly into totalAmount", () => {
    const state = baseState({
      hourBuckets: { regularMinutes: 480, otMinutes: 60, dtMinutes: 30 }, // 8h reg, 1h OT, 0.5h DT
      differentialApplications: [
        {
          policyId: "policy-diff-1",
          policyType: "SHIFT_DIFFERENTIAL",
          band: { start: "22:00", end: "06:00" },
          minutesAffected: 60,
          differentialType: "flat",
          value: 15,
          appliesToSegmentRefs: [],
        },
        {
          policyId: "policy-diff-2",
          policyType: "NIGHT_DIFFERENTIAL",
          band: { start: "22:00", end: "06:00" },
          minutesAffected: 60,
          differentialType: "percent",
          value: 10,
          appliesToSegmentRefs: [],
        },
      ],
      penalties: [
        { policyId: "policy-penalty-1", policyType: "MEAL_BREAK", type: "premium_pay", hours: 1, rate: "regular", reason: "x" },
      ],
      rate: { rateType: "hourly", baseRate: 10, minimumWage: 10 },
    });

    const result = finalizeAmounts(state);

    // regular: 8h*10=80; ot: 1h*10*1.5=15; dt: 0.5h*10*2=10; diff: 15 (flat) + 1h*10*0.10=1 => 16; premium: 1h*10*1=10.
    expect(result.regularAmount).toBe(80);
    expect(result.otAmount).toBe(15);
    expect(result.dtAmount).toBe(10);
    expect(result.differentialAmount).toBe(16);
    expect(result.premiumAmount).toBe(10);
    expect(result.totalAmount).toBe(80 + 15 + 10 + 16 + 10);
  });

  it("rounds every amount to 2 decimal places, even with minutes that don't divide evenly by 60", () => {
    const state = baseState({
      // 100 minutes at baseRate 17 produces floating-point noise if not rounded properly.
      hourBuckets: { regularMinutes: 100, otMinutes: 70, dtMinutes: 50 },
      rate: { rateType: "hourly", baseRate: 17, minimumWage: 15 },
    });

    const result = finalizeAmounts(state);

    // regular: (100/60)*17 = 28.333333...
    expect(result.regularAmount).toBe(28.33);
    // ot: (70/60)*17*1.5 = 29.75
    expect(result.otAmount).toBe(29.75);
    // dt: (50/60)*17*2 = 28.333333...
    expect(result.dtAmount).toBe(28.33);

    // Every field must be a clean 2-decimal number (no trailing floating-point noise).
    for (const value of [result.regularAmount, result.otAmount, result.dtAmount, result.totalAmount]) {
      expect(value).toBe(Math.round(value * 100) / 100);
    }
  });

  it("rounds a percent differential's fractional cents correctly", () => {
    const differential: DifferentialApplication = {
      policyId: "policy-diff-3",
      policyType: "PAY_DIFFERENTIAL",
      band: { conditionCode: "HAZARD" },
      minutesAffected: 50, // doesn't divide evenly into 60
      differentialType: "percent",
      value: 12.5,
      appliesToSegmentRefs: [],
    };
    const state = baseState({
      differentialApplications: [differential],
      rate: { rateType: "hourly", baseRate: 19, minimumWage: 15 },
    });

    const result = finalizeAmounts(state);

    // (50/60) * 19 * 0.125 = 1.979166...
    expect(result.differentialAmount).toBe(1.98);
  });
});
