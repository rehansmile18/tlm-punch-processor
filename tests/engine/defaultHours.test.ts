import { describe, expect, it } from "vitest";
import { applyDefaultHoursIfUnset } from "../../src/engine/defaultHours";
import { createInitialState, ProcessingState, Segment } from "../../src/engine/types";

function makeSegments(startIso: string, endIso: string): Segment[] {
  return [
    {
      startIso,
      endIso,
      sourcePunchIds: ["punch-1"],
      siteId: "site-1",
      task: "default",
      paid: true,
      createdByPolicyId: null,
    },
  ];
}

function baseState(overrides: Partial<ProcessingState> = {}): ProcessingState {
  const state = createInitialState("2026-07-20", "America/New_York", makeSegments("2026-07-20T09:00:00.000Z", "2026-07-20T17:00:00.000Z"));
  return { ...state, ...overrides };
}

describe("applyDefaultHoursIfUnset", () => {
  it("counts every worked minute as regular time when hourBuckets was never touched (no OVERTIME policy resolved)", () => {
    const state = baseState(); // hourBuckets stays at createInitialState's zeroed default

    const result = applyDefaultHoursIfUnset(state);

    expect(result.hourBuckets).toEqual({ regularMinutes: 480, otMinutes: 0, dtMinutes: 0 }); // 8h
  });

  it("leaves hourBuckets untouched if a processor already set it (e.g. OVERTIME ran)", () => {
    const state = baseState({ hourBuckets: { regularMinutes: 300, otMinutes: 60, dtMinutes: 0 } });

    const result = applyDefaultHoursIfUnset(state);

    expect(result.hourBuckets).toEqual({ regularMinutes: 300, otMinutes: 60, dtMinutes: 0 });
  });

  it("leaves hourBuckets untouched if a processor deliberately zeroed everything out (e.g. all OT, none regular)", () => {
    const state = baseState({ hourBuckets: { regularMinutes: 0, otMinutes: 480, dtMinutes: 0 } });

    const result = applyDefaultHoursIfUnset(state);

    expect(result.hourBuckets).toEqual({ regularMinutes: 0, otMinutes: 480, dtMinutes: 0 });
  });

  it("is a no-op when there are no worked segments at all", () => {
    const state = createInitialState("2026-07-20", "America/New_York", []);

    const result = applyDefaultHoursIfUnset(state);

    expect(result.hourBuckets).toEqual({ regularMinutes: 0, otMinutes: 0, dtMinutes: 0 });
    expect(result).toBe(state); // genuine no-op, not just an equal-shaped copy
  });
});
