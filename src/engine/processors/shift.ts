import { Penalty, ProcessingContext, ProcessingState, RemotePolicy, RuleProcessor, Segment, Violation } from "../types";

// TLM's SHIFT policy.rules shape (policy.rules is typed `any` on RemotePolicy — cast locally).
interface ShiftRules {
  minShiftLengthHours: number;
  maxShiftLengthHours: number;
  minRestBetweenShiftsHours: number; // NOTE: not enforceable here, see comment below.
  splitShiftPremium: { enabled: boolean; hours: number };
}

const MINUTES_PER_HOUR = 60;
const SPLIT_SHIFT_GAP_THRESHOLD_MINUTES = 60;

function segmentMinutes(seg: Segment): number {
  return (new Date(seg.endIso).getTime() - new Date(seg.startIso).getTime()) / 60000;
}

function totalMinutes(segments: Segment[]): number {
  return segments.reduce((sum, seg) => sum + segmentMinutes(seg), 0);
}

/**
 * Detects whether any gap between consecutive (start-sorted) segments exceeds the split-shift
 * threshold. A gap is the number of minutes between one segment's end and the next segment's
 * start; a gap this large (as opposed to e.g. a quick task-switch of a few minutes) indicates the
 * employee left and came back for a separate shift block within the same business day.
 */
function hasSplitShiftGap(segments: Segment[]): boolean {
  if (segments.length < 2) return false;
  const sorted = [...segments].sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gapMinutes = (new Date(curr.startIso).getTime() - new Date(prev.endIso).getTime()) / 60000;
    if (gapMinutes > SPLIT_SHIFT_GAP_THRESHOLD_MINUTES) return true;
  }
  return false;
}

/**
 * SHIFT processor — ADDITIVE archetype (violations only, plus an optional split-shift premium
 * penalty). Never touches workSegments/hourBuckets.
 *
 * rules.minRestBetweenShiftsHours governs rest BETWEEN separate shifts on different business
 * days. This processor operates on a single day's ProcessingState and has no visibility into the
 * previous or next business day's segments, so that check is out of scope here — it would need to
 * be a cross-day check performed by the orchestrator (which can see adjacent days), not by this
 * single-day processor.
 */
export const processShift: RuleProcessor = (
  state: ProcessingState,
  policy: RemotePolicy,
  _ctx: ProcessingContext
): ProcessingState => {
  const rules = policy.rules as ShiftRules;

  const totalHours = totalMinutes(state.rawSegments) / MINUTES_PER_HOUR;

  const newViolations: Violation[] = [];

  if (totalHours < rules.minShiftLengthHours) {
    newViolations.push({
      policyId: policy.policyId,
      policyType: policy.policyType,
      code: "shift_too_short",
      message: `Shift length ${totalHours.toFixed(2)}h is below the minimum of ${rules.minShiftLengthHours}h.`,
      severity: "warning",
    });
  }

  if (totalHours > rules.maxShiftLengthHours) {
    newViolations.push({
      policyId: policy.policyId,
      policyType: policy.policyType,
      code: "shift_too_long",
      message: `Shift length ${totalHours.toFixed(2)}h exceeds the maximum of ${rules.maxShiftLengthHours}h.`,
      severity: "review_required",
    });
  }

  const newPenalties: Penalty[] = [];

  if (rules.splitShiftPremium.enabled && hasSplitShiftGap(state.rawSegments)) {
    newPenalties.push({
      policyId: policy.policyId,
      policyType: policy.policyType,
      type: "premium_pay",
      hours: rules.splitShiftPremium.hours,
      rate: "regular",
      reason: "split shift premium",
    });
  }

  if (newViolations.length === 0 && newPenalties.length === 0) {
    return state;
  }

  return {
    ...state,
    violations: [...state.violations, ...newViolations],
    penalties: [...state.penalties, ...newPenalties],
  };
};
