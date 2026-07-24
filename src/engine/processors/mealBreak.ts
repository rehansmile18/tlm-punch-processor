import { RuleProcessor, Segment } from "../types";

// TLM's MEAL_BREAK policy.rules shape (policy.rules is `any` on RemotePolicy — cast locally).
interface MealBreakRules {
  minShiftLengthForMealMinutes: number;
  mealDurationMinMinutes: number;
  paidMeal: boolean;
  waiverAllowed: boolean; // not consulted by this MVP model — see processMealBreak doc comment.
}

function segmentMinutes(seg: Segment): number {
  return (new Date(seg.endIso).getTime() - new Date(seg.startIso).getTime()) / 60000;
}

function totalMinutes(segments: Segment[]): number {
  return segments.reduce((sum, seg) => sum + segmentMinutes(seg), 0);
}

function hasExistingDeduction(segments: Segment[], policyId: string): boolean {
  return segments.some((seg) => seg.paid === false && seg.createdByPolicyId === policyId);
}

/**
 * MVP NOTE: this system has no literal meal-punch event — only clock-in/clock-out segments — so
 * there is no timestamp telling us exactly when within the shift a meal happened. We approximate a
 * meal deduction by carving `minutesToDeduct` off the END of the last segment in the array:
 *   - the tail chunk (length `minutesToDeduct`, capped at the last segment's own duration) becomes
 *     its own unpaid Segment (`paid: false`, `createdByPolicyId: policyId`) — matching the Segment
 *     type's documented convention ("paid: false ... for unpaid meal segments carved out of a work
 *     segment").
 *   - that carved segment doubles as this processor's idempotency marker: a later run can see "a
 *     segment here is already flagged paid:false for this exact policyId" and knows to restore from
 *     rawSegments and re-deduct fresh, rather than compounding the deduction on every rerun.
 *   - if the last segment's own duration is <= minutesToDeduct, the ENTIRE segment becomes the
 *     carved-out (unpaid) chunk — there's no positive-duration work remainder to keep, and we don't
 *     cascade the leftover minutes into earlier segments (documented simplification; not expected to
 *     matter for realistic shift-length/meal-length ratios).
 */
function deductMealFromEnd(segments: Segment[], minutesToDeduct: number, policyId: string): Segment[] {
  if (segments.length === 0 || minutesToDeduct <= 0) return segments;

  const result = segments.slice();
  const lastIndex = result.length - 1;
  const last = result[lastIndex];
  const lastDurationMinutes = segmentMinutes(last);
  const carvedMinutes = Math.min(minutesToDeduct, lastDurationMinutes);

  if (lastDurationMinutes - carvedMinutes <= 0) {
    result[lastIndex] = { ...last, paid: false, createdByPolicyId: policyId };
    return result;
  }

  const carveStartIso = new Date(new Date(last.endIso).getTime() - carvedMinutes * 60000).toISOString();
  result[lastIndex] = { ...last, endIso: carveStartIso };
  result.push({
    ...last,
    startIso: carveStartIso,
    endIso: last.endIso,
    paid: false,
    createdByPolicyId: policyId,
  });
  return result;
}

/**
 * MEAL_BREAK: deducts one unpaid meal break from the end of the shift when the shift is long
 * enough to require one ("was a meal required" is always measured against the FULL, untrimmed
 * rawSegments total, never the already-trimmed workSegments) and the policy says the meal is
 * unpaid. Idempotent-overwrite archetype on workSegments: rerunning this processor (e.g. once per
 * layer that resolves to the same MEAL_BREAK policy) never compounds the deduction — it restores
 * workSegments back to rawSegments first, then re-deducts fresh.
 *
 * No penalty/violation logic at all here — unlike CA_MEAL_BREAK, TLM's MEAL_BREAK rules shape
 * carries no premium-pay concept, so a paid meal simply means nothing is ever carved out.
 */
export const processMealBreak: RuleProcessor = (state, policy, _ctx) => {
  const rules = policy.rules as MealBreakRules;

  if (rules.paidMeal) {
    // Paid meal: never carved out as unpaid time, so there's nothing to deduct. (We don't
    // retroactively undo a deduction applied under a since-changed policy version here — this
    // processor's contract is "apply today's policy to today's segments", not full historical
    // reconciliation across policy version changes.)
    return state;
  }

  const totalRawMinutes = totalMinutes(state.rawSegments);
  if (totalRawMinutes < rules.minShiftLengthForMealMinutes) {
    return state;
  }

  const alreadyApplied = hasExistingDeduction(state.workSegments, policy.policyId);
  const baseline = alreadyApplied ? state.rawSegments : state.workSegments;
  const workSegments = deductMealFromEnd(baseline, rules.mealDurationMinMinutes, policy.policyId);

  return { ...state, workSegments };
};
