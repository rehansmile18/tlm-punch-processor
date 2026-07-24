import { DifferentialApplication, ProcessingContext, ProcessingState, RemotePolicy, RuleProcessor, Segment } from "../types";

interface PayDifferentialCondition {
  type: string;
  code: string;
  differentialType: "percent" | "flat";
  value: number;
}

interface PayDifferentialRules {
  conditions: PayDifferentialCondition[];
}

function totalMinutes(segments: Segment[]): number {
  return segments.reduce((sum, seg) => sum + (new Date(seg.endIso).getTime() - new Date(seg.startIso).getTime()) / 60000, 0);
}

/**
 * PAY_DIFFERENTIAL processor — ADDITIVE archetype (condition-based, not time-band-based).
 *
 * For each condition in policy.rules.conditions whose `code` exactly matches ctx.task, appends a
 * DifferentialApplication covering the whole shift's worked minutes. Never touches
 * workSegments/hourBuckets. Non-matching conditions are silently skipped. No dedup — a repeat
 * resolution with identical conditions is expected to produce identical-looking entries.
 */
export const processPayDifferential: RuleProcessor = (
  state: ProcessingState,
  policy: RemotePolicy,
  ctx: ProcessingContext,
): ProcessingState => {
  const rules = policy.rules as PayDifferentialRules;
  const minutesAffected = totalMinutes(state.workSegments);

  const newApplications: DifferentialApplication[] = rules.conditions
    .filter((condition) => condition.code === ctx.task)
    .map((condition) => ({
      policyId: policy.policyId,
      policyType: "PAY_DIFFERENTIAL",
      band: { conditionCode: condition.code },
      minutesAffected,
      differentialType: condition.differentialType,
      value: condition.value,
      appliesToSegmentRefs: [],
    }));

  if (newApplications.length === 0) {
    return state;
  }

  return {
    ...state,
    differentialApplications: [...state.differentialApplications, ...newApplications],
  };
};
