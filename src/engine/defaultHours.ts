import { ProcessingState } from "./types";

function segmentMinutes(segments: ProcessingState["workSegments"]): number {
  return segments.reduce((sum, seg) => sum + (new Date(seg.endIso).getTime() - new Date(seg.startIso).getTime()) / 60000, 0);
}

/**
 * hourBuckets starts zeroed (see createInitialState) and the ONLY processor that ever populates it
 * from real worked time is OVERTIME (see engine/processors/overtime.ts) — SHIFT, despite the name,
 * never touches it; it's a violations-only check. A client with no OVERTIME policy resolved for an
 * employee/day therefore gets a Timesheet line with a real rate but zero hours and zero pay, even
 * though a real punch was worked — silently paying nothing rather than reporting a gap.
 *
 * If nothing in the resolved policy chain ever set hourBuckets away from that zero default, fall
 * back to counting every worked minute as straight regular time — exactly what OVERTIME itself
 * would compute if it were configured with no thresholds at all (see splitByThresholds's
 * otThreshold == null && dtThreshold == null case). A configured OVERTIME policy always still wins:
 * it runs as part of the normal pipeline and overwrites hourBuckets before this ever sees it.
 */
export function applyDefaultHoursIfUnset(state: ProcessingState): ProcessingState {
  const { regularMinutes, otMinutes, dtMinutes } = state.hourBuckets;
  if (regularMinutes !== 0 || otMinutes !== 0 || dtMinutes !== 0) return state;

  const totalMinutes = segmentMinutes(state.workSegments);
  if (totalMinutes === 0) return state;

  return { ...state, hourBuckets: { regularMinutes: totalMinutes, otMinutes: 0, dtMinutes: 0 } };
}
