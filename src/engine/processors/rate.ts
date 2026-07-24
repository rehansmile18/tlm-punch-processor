import { ProcessingContext, ProcessingState, RemotePolicy, RuleProcessor } from "../types";

// TLM's RATE policy.rules shape.
interface RateRules {
  rateType: "hourly" | "salary";
  minimumWage: number;
  minimumWageSource: string;
}

/**
 * RATE — EXTREMAL archetype.
 *
 * This is the one processor type in the pipeline that must NOT simply overwrite state on each
 * run. state.rate.minimumWage tracks a running MAX across however many RATE-typed layers/policies
 * fire for a given day (e.g. a broader federal/state floor set by an earlier layer, then a
 * narrower site/employee layer running afterward). Taking the max means a narrower, later-running
 * layer can never silently undercut a statutory wage floor established by an earlier, broader one.
 *
 * rateType is last-write-wins — it is not a "floor" concept, just whatever the most recent RATE
 * policy declares.
 *
 * baseRate simplification (MVP): this engine has no employee pay-record lookup in scope, so there
 * is no real "actual rate" to seed baseRate from. Instead, baseRate is seeded from the running
 * minimumWage floor: it is bumped up to match minimumWage whenever baseRate is still unset (0) or
 * currently below the (possibly just-raised) minimumWage. This guarantees baseRate is never
 * initialized below the wage floor. In a real system baseRate would instead come from the
 * employee's actual pay record.
 */
export const processRate: RuleProcessor = (
  state: ProcessingState,
  policy: RemotePolicy,
  _ctx: ProcessingContext
): ProcessingState => {
  const rules = policy.rules as RateRules;

  const newMinimumWage = Math.max(state.rate.minimumWage, rules.minimumWage);
  const newBaseRate = state.rate.baseRate === 0 || rules.minimumWage > state.rate.baseRate ? rules.minimumWage : state.rate.baseRate;

  return {
    ...state,
    rate: {
      rateType: rules.rateType,
      baseRate: newBaseRate,
      minimumWage: newMinimumWage,
    },
  };
};
