import { RuleProcessor, Segment, Violation } from "../types";

// TLM's CA_MEAL_BREAK policy.rules shape (policy.rules is `any` on RemotePolicy — cast locally).
interface CaMealBreakRules {
  minShiftLengthForFirstMealMinutes: number;
  mealDurationMinMinutes: number;
  mealMustStartByHourIntoShift: number; // not consulted by this MVP model — see doc comment below.
  waiverAllowedUnderShiftHours: number;
  secondMealRequiredOverShiftHours: number;
  onDutyMealAllowed: boolean;
  penalty: { type: "premium_pay"; hours: number; rate: "regular" | "overtime" };
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

// Same carve-from-end mechanics as processMealBreak's helper of the same name — duplicated rather
// than imported because processors in this engine import solely from "../types" (see file header
// convention across src/engine/processors/). See the doc comment on processCaMealBreak for the
// rationale (no literal meal-punch timestamps exist, so we approximate + mark for idempotency).
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
 * CA_MEAL_BREAK: California's on-duty/first-meal/second-meal rules.
 *
 * MVP NOTE (read before touching this file): this system has no literal meal-punch event, only
 * clock-in/clock-out segments, so it can NEVER tell "a compliant meal was actually taken" apart
 * from "a meal was owed but skipped" — both look identical (a shift that ran long with no separate
 * meal punch). We deliberately do not guess. The honest behavior is: always MODEL the deduction
 * (so paid-hour totals reflect the meal-length rule) AND always attach a Violation (severity
 * "warning", never "review_required" — this never blocks processing) explaining that a human needs
 * to confirm whether the meal was really taken, or whether premium pay is actually owed instead.
 * We NEVER auto-append a Penalty for this — `rules.penalty` is surfaced only inside the Violation
 * message as informational guidance for whoever reviews it, never written to state.penalties.
 * Auto-penalizing on ambiguous data risks silently overpaying (if the meal was in fact taken); auto
 * -skipping the deduction risks silently underpaying elsewhere. Flagging for review avoids both.
 *
 * `mealMustStartByHourIntoShift` is likewise not evaluated here for the same reason — there's no
 * meal-start timestamp to check it against.
 *
 * Second-meal / waiver handling (idempotent-overwrite archetype on workSegments, same restore-then
 * -rededuct pattern as processMealBreak):
 *   - shift < minShiftLengthForFirstMealMinutes: no meal required, no deduction, no violation.
 *   - onDutyMealAllowed: the meal is on-duty/paid under this policy, nothing carved out.
 *   - shift > secondMealRequiredOverShiftHours*60 but still <= waiverAllowedUnderShiftHours*60: a
 *     second meal may be owed, but the shift length is ALSO short enough that a lawful mutual
 *     waiver of that second meal could apply — without an actual waiver record we can't tell which,
 *     so we conservatively deduct only the base (first) meal and flag the ambiguity.
 *   - shift > secondMealRequiredOverShiftHours*60 AND > waiverAllowedUnderShiftHours*60: too long
 *     for any lawful waiver — a second meal is unconditionally required, so both meal blocks
 *     (2 * mealDurationMinMinutes) are deducted, still flagged for confirmation.
 *   - otherwise: only the base meal is required; deducted, flagged for confirmation.
 */
export const processCaMealBreak: RuleProcessor = (state, policy, _ctx) => {
  const rules = policy.rules as CaMealBreakRules;

  const totalRawMinutes = totalMinutes(state.rawSegments);
  if (totalRawMinutes < rules.minShiftLengthForFirstMealMinutes) {
    return state;
  }

  if (rules.onDutyMealAllowed) {
    // On-duty meal permitted (paid) under this policy — nothing carved out, no deduction.
    return state;
  }

  const secondMealThresholdMinutes = rules.secondMealRequiredOverShiftHours * 60;
  const waiverEligibleThresholdMinutes = rules.waiverAllowedUnderShiftHours * 60;
  const secondMealTriggered = totalRawMinutes > secondMealThresholdMinutes;
  const withinWaiverRange = totalRawMinutes <= waiverEligibleThresholdMinutes;

  const mealsToDeduct = secondMealTriggered && !withinWaiverRange ? 2 : 1;
  const minutesToDeduct = rules.mealDurationMinMinutes * mealsToDeduct;

  const alreadyApplied = hasExistingDeduction(state.workSegments, policy.policyId);
  const baseline = alreadyApplied ? state.rawSegments : state.workSegments;
  const workSegments = deductMealFromEnd(baseline, minutesToDeduct, policy.policyId);

  let violation: Violation;
  if (secondMealTriggered && withinWaiverRange) {
    violation = {
      policyId: policy.policyId,
      policyType: policy.policyType,
      code: "CA_SECOND_MEAL_WAIVER_UNCONFIRMED",
      message:
        `Shift is ${Math.round(totalRawMinutes)} minutes — over the ${rules.secondMealRequiredOverShiftHours}h ` +
        `second-meal threshold but still within the ${rules.waiverAllowedUnderShiftHours}h waiver-eligible range, ` +
        `so a second meal may have been validly waived. Only the base meal was deducted; confirm whether a waiver ` +
        `is on file, or whether a second meal (and possible premium pay of ${rules.penalty.hours}h at ` +
        `${rules.penalty.rate} rate) is actually owed.`,
      severity: "warning",
    };
  } else if (secondMealTriggered) {
    violation = {
      policyId: policy.policyId,
      policyType: policy.policyType,
      code: "CA_SECOND_MEAL_REQUIRED",
      message:
        `Shift is ${Math.round(totalRawMinutes)} minutes — beyond both the ${rules.secondMealRequiredOverShiftHours}h ` +
        `second-meal threshold and the ${rules.waiverAllowedUnderShiftHours}h waiver-eligible range, so a second ` +
        `meal is unconditionally required. Both meal blocks were deducted; confirm the meals were actually taken, ` +
        `or whether premium pay of ${rules.penalty.hours}h at ${rules.penalty.rate} rate is owed instead.`,
      severity: "warning",
    };
  } else {
    violation = {
      policyId: policy.policyId,
      policyType: policy.policyType,
      code: "CA_MEAL_DEDUCTION_UNCONFIRMED",
      message:
        `Meal break time was deducted based on shift length alone; no meal-punch data exists to confirm the meal ` +
        `was actually taken. Confirm compliance, or whether premium pay of ${rules.penalty.hours}h at ` +
        `${rules.penalty.rate} rate is owed instead.`,
      severity: "warning",
    };
  }

  return { ...state, workSegments, violations: [...state.violations, violation] };
};
