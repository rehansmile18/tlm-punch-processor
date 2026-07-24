import { ProcessingState, RemotePolicy, ProcessingContext, RuleProcessor, Violation } from "../types";

// TLM's REST_BREAK policy.rules shape (mirrors TLM's own polymorphic Policy.rules).
interface RestBreakRules {
  paidRestBreak: boolean;
  restBreakDurationMinutes: number;
  minutesOfWorkPerRestBreak: number;
  penalty: {
    type: "premium_pay";
    hours: number;
    rate: "regular" | "overtime";
  };
}

/**
 * ADDITIVE archetype: penalties/violations only — never touches workSegments/hourBuckets.
 * Rest breaks are paid time in virtually every jurisdiction that mandates them (paidRestBreak is
 * almost always true, and even when false this MVP does not model a deduction for rest breaks —
 * only meal breaks get deducted). With no discrete break-punch events to signal whether a
 * required rest break was actually taken, this processor only flags a violation for manual
 * review; it never auto-appends a Penalty (same reasoning as CA_MEAL_BREAK).
 */
export const processRestBreak: RuleProcessor = (
  state: ProcessingState,
  policy: RemotePolicy,
  _ctx: ProcessingContext
): ProcessingState => {
  const rules = policy.rules as RestBreakRules;

  const totalMinutes = state.rawSegments.reduce(
    (sum, seg) => sum + (new Date(seg.endIso).getTime() - new Date(seg.startIso).getTime()) / 60000,
    0
  );

  const requiredBreakCount = Math.floor(totalMinutes / rules.minutesOfWorkPerRestBreak);

  if (requiredBreakCount <= 0) {
    return state;
  }

  const violation: Violation = {
    policyId: policy.policyId,
    policyType: policy.policyType,
    code: "rest_break_review_required",
    message:
      `Shift qualifies for ${requiredBreakCount} rest break(s) of ${rules.restBreakDurationMinutes}min each — ` +
      `verify taken; manual review may apply the ${rules.penalty.hours}h ${rules.penalty.rate} penalty if missed.`,
    severity: "warning",
  };

  return { ...state, violations: [...state.violations, violation] };
};
