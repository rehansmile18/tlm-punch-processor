import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import { buildSegmentsFromPunches, hasOpenPunch } from "../../src/engine/segments";
import { PunchDoc } from "../../src/models/punch.model";

function makePunch(overrides: Partial<PunchDoc> = {}): PunchDoc {
  return {
    _id: new Types.ObjectId(),
    clientId: new Types.ObjectId(),
    employeeId: "employee-1",
    siteId: "site-1",
    task: "task-1",
    clockIn: new Date("2026-07-20T09:00:00.000Z"),
    clockOut: new Date("2026-07-20T13:00:00.000Z"),
    timezone: "America/Los_Angeles",
    status: "closed",
    correctionOfPunchId: null,
    rejectionReason: null,
    createdAt: new Date("2026-07-20T09:00:00.000Z"),
    updatedAt: new Date("2026-07-20T13:00:00.000Z"),
    ...overrides,
  };
}

describe("buildSegmentsFromPunches", () => {
  it("maps a closed punch to a Segment with the expected fields", () => {
    const punch = makePunch();

    const segments = buildSegmentsFromPunches([punch]);

    expect(segments).toEqual([
      {
        startIso: punch.clockIn.toISOString(),
        endIso: (punch.clockOut as Date).toISOString(),
        sourcePunchIds: [String(punch._id)],
        siteId: punch.siteId,
        task: punch.task,
        paid: true,
        createdByPolicyId: null,
      },
    ]);
  });

  it("sorts the resulting segments by start time ascending, even if input order is scrambled", () => {
    const early = makePunch({
      clockIn: new Date("2026-07-20T08:00:00.000Z"),
      clockOut: new Date("2026-07-20T09:00:00.000Z"),
    });
    const mid = makePunch({
      clockIn: new Date("2026-07-20T12:00:00.000Z"),
      clockOut: new Date("2026-07-20T13:00:00.000Z"),
    });
    const late = makePunch({
      clockIn: new Date("2026-07-20T18:00:00.000Z"),
      clockOut: new Date("2026-07-20T19:00:00.000Z"),
    });

    const segments = buildSegmentsFromPunches([late, early, mid]);

    expect(segments.map((s) => s.startIso)).toEqual([early.clockIn.toISOString(), mid.clockIn.toISOString(), late.clockIn.toISOString()]);
  });

  it("excludes any punch with clockOut === null from the output", () => {
    const closed = makePunch();
    const open = makePunch({
      clockIn: new Date("2026-07-20T20:00:00.000Z"),
      clockOut: null,
      status: "open",
    });

    const segments = buildSegmentsFromPunches([closed, open]);

    expect(segments).toHaveLength(1);
    expect(segments[0].sourcePunchIds).toEqual([String(closed._id)]);
  });

  it("returns an empty array when given no punches", () => {
    expect(buildSegmentsFromPunches([])).toEqual([]);
  });
});

describe("hasOpenPunch", () => {
  it("returns true when the array contains an open punch", () => {
    const closed = makePunch();
    const open = makePunch({ clockOut: null, status: "open" });

    expect(hasOpenPunch([closed, open])).toBe(true);
  });

  it("returns false when every punch in the array is closed", () => {
    const punches = [makePunch(), makePunch(), makePunch()];

    expect(hasOpenPunch(punches)).toBe(false);
  });

  it("returns false for an empty array", () => {
    expect(hasOpenPunch([])).toBe(false);
  });
});
