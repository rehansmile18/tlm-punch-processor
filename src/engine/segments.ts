import { PunchDoc } from "../models/punch.model";
import { Segment } from "./types";

/**
 * Maps CLOSED punches (clockOut !== null) into raw, as-punched Segments, sorted by start time.
 * Open punches are filtered out entirely — the caller (orchestrator) is responsible for deciding
 * whether a business day containing an open punch can be finalized at all; see hasOpenPunch below.
 */
export function buildSegmentsFromPunches(punches: PunchDoc[]): Segment[] {
  return punches
    .filter((punch): punch is PunchDoc & { clockOut: Date } => punch.clockOut !== null)
    .map(
      (punch): Segment => ({
        startIso: punch.clockIn.toISOString(),
        endIso: punch.clockOut.toISOString(),
        sourcePunchIds: [String(punch._id)],
        siteId: punch.siteId,
        task: punch.task,
        paid: true,
        createdByPolicyId: null,
      })
    )
    .sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());
}

/** True if any punch in the array is still open (clockOut === null). */
export function hasOpenPunch(punches: PunchDoc[]): boolean {
  return punches.some((punch) => punch.clockOut === null);
}
