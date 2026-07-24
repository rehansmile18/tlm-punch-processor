import { ProcessingContext, ProcessingState, RemotePolicy, RuleProcessor } from "../types";

// TLM's PAYGROUP policy.rules shape (documented for reference only — this processor reads none
// of these fields; see the no-op rationale below):
//   { payFrequency: "weekly"|"biweekly"|"semimonthly"|"monthly"; workweekStart: string;
//     defaultOvertimePolicyId: string | null }

/**
 * PAYGROUP — deliberate NO-OP pass-through.
 *
 * payFrequency/workweekStart/defaultOvertimePolicyId are pay-period-level configuration consumed
 * by the ORCHESTRATOR (which reads the resolved policy list directly to determine period
 * boundaries and which OVERTIME policy applies), not day-level structural facts that this
 * per-day ProcessingState pipeline computes. There is nothing on ProcessingState for a PAYGROUP
 * policy to legitimately change, so this processor intentionally does nothing.
 *
 * Returning the exact same `state` reference (rather than a shallow-spread copy) is safe here —
 * and slightly cheaper — precisely because this is a provable no-op: unlike every other
 * processor, PAYGROUP never reads or derives anything from `policy.rules` to fold into state.
 */
export const processPaygroup: RuleProcessor = (
  state: ProcessingState,
  _policy: RemotePolicy,
  _ctx: ProcessingContext
): ProcessingState => {
  return state;
};
