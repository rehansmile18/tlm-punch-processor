import { FinalAmounts, ProcessingState } from "./types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Runs ONCE, after the whole pipeline completes — converts the accumulated STRUCTURAL facts
 * (hourBuckets, differentialApplications, penalties, rate) into dollar amounts, decoupled from
 * whatever order the rule-authoring put policies in. Not a RuleProcessor, not part of the
 * registry: this is a pure post-processing step over the pipeline's finalState.
 */
export function finalizeAmounts(state: ProcessingState): FinalAmounts {
  const { baseRate } = state.rate;

  const regularAmount = (state.hourBuckets.regularMinutes / 60) * baseRate;
  const otAmount = (state.hourBuckets.otMinutes / 60) * baseRate * 1.5;
  const dtAmount = (state.hourBuckets.dtMinutes / 60) * baseRate * 2;

  const differentialAmount = state.differentialApplications.reduce((total, application) => {
    if (application.differentialType === "flat") {
      return total + application.value;
    }
    return total + (application.minutesAffected / 60) * baseRate * (application.value / 100);
  }, 0);

  const premiumAmount = state.penalties.reduce((total, penalty) => {
    return total + penalty.hours * baseRate * (penalty.rate === "overtime" ? 1.5 : 1);
  }, 0);

  // Round each component individually FIRST, then sum the already-rounded components for the
  // total. This keeps totalAmount exactly equal to the sum of the five rounded fields that get
  // displayed/persisted alongside it, rather than letting it drift from a separately-rounded sum
  // of the raw (unrounded) components.
  const roundedRegularAmount = round2(regularAmount);
  const roundedOtAmount = round2(otAmount);
  const roundedDtAmount = round2(dtAmount);
  const roundedDifferentialAmount = round2(differentialAmount);
  const roundedPremiumAmount = round2(premiumAmount);

  const totalAmount =
    roundedRegularAmount + roundedOtAmount + roundedDtAmount + roundedDifferentialAmount + roundedPremiumAmount;

  return {
    regularAmount: roundedRegularAmount,
    otAmount: roundedOtAmount,
    dtAmount: roundedDtAmount,
    differentialAmount: roundedDifferentialAmount,
    premiumAmount: roundedPremiumAmount,
    totalAmount: round2(totalAmount),
  };
}
