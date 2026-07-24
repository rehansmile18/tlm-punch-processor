import { PolicyType } from "../types/domain";
import { ProcessingContext, ProcessingState, RemotePolicy, RuleProcessor, SourceAssignmentTag } from "./types";

export interface PipelineStep {
  policy: RemotePolicy; // has policyId, version, policyType, name, rules
  sourceAssignment: SourceAssignmentTag; // { assignmentId, targetType, priority, ruleGroupId, ruleGroupVersion }
}

export interface PipelineStepResult {
  sequenceIndex: number;
  sourceAssignment: SourceAssignmentTag;
  policyId: string;
  policyType: PolicyType;
  policyVersion: number;
  inputState: ProcessingState; // deep-cloned snapshot BEFORE this step ran
  outputState: ProcessingState; // deep-cloned snapshot AFTER this step ran
  humanReadableSummary: string;
  durationMs: number;
}

export interface PipelineResult {
  finalState: ProcessingState;
  steps: PipelineStepResult[];
}

/**
 * Describes, in a short human-readable sentence, what observably changed in state across a single
 * step. Pragmatic, not exhaustive: checks the handful of top-level slices a processor is expected
 * to touch, in priority order, and stops at the first one that changed. Falls back to "no change"
 * for genuine no-ops (e.g. PAYGROUP).
 */
function summarizeChange(before: ProcessingState, after: ProcessingState): string {
  if (JSON.stringify(before.hourBuckets) !== JSON.stringify(after.hourBuckets)) {
    const { regularMinutes, otMinutes, dtMinutes } = after.hourBuckets;
    return `hourBuckets set to regular=${regularMinutes}m/ot=${otMinutes}m/dt=${dtMinutes}m`;
  }

  if (after.differentialApplications.length !== before.differentialApplications.length) {
    const added = after.differentialApplications.length - before.differentialApplications.length;
    return `${added} new differential application(s) added`;
  }

  if (after.penalties.length !== before.penalties.length) {
    const added = after.penalties.length - before.penalties.length;
    return `${added} new penalty(ies) added`;
  }

  if (after.violations.length !== before.violations.length) {
    const added = after.violations.length - before.violations.length;
    return `${added} new violation(s) added`;
  }

  if (JSON.stringify(before.rate) !== JSON.stringify(after.rate)) {
    const { rateType, baseRate, minimumWage } = after.rate;
    return `rate set to rateType=${rateType}/baseRate=${baseRate}/minimumWage=${minimumWage}`;
  }

  if (JSON.stringify(before.workSegments) !== JSON.stringify(after.workSegments)) {
    return `workSegments changed (${before.workSegments.length} -> ${after.workSegments.length} segments)`;
  }

  return "no change";
}

/**
 * Folds a day's ordered, already-resolved policy steps over an initial ProcessingState, invoking
 * each step's registered RuleProcessor in turn and threading the resulting state to the next step.
 * Ordering/resolution is entirely the caller's responsibility — this function just executes the
 * sequence it's given and records a full before/after audit trail as it goes.
 */
export function runPipeline(
  orderedSteps: PipelineStep[],
  initialState: ProcessingState,
  ctx: Omit<ProcessingContext, "sourceAssignment">,
  registry: Record<PolicyType, RuleProcessor>
): PipelineResult {
  const steps: PipelineStepResult[] = [];
  let currentState = initialState;

  orderedSteps.forEach((step, sequenceIndex) => {
    const processor = registry[step.policy.policyType];
    if (!processor) {
      throw new Error(
        `No RuleProcessor registered for policyType "${step.policy.policyType}" (policyId=${step.policy.policyId})`
      );
    }

    const stepCtx: ProcessingContext = { ...ctx, sourceAssignment: step.sourceAssignment };

    const inputState = structuredClone(currentState);
    const startedAt = Date.now();
    const nextState = processor(currentState, step.policy, stepCtx);
    const durationMs = Date.now() - startedAt;
    const outputState = structuredClone(nextState);

    const humanReadableSummary = `${step.policy.policyType} (${step.sourceAssignment.targetType} assignment, priority ${step.sourceAssignment.priority}): ${summarizeChange(inputState, outputState)}`;

    steps.push({
      sequenceIndex,
      sourceAssignment: step.sourceAssignment,
      policyId: step.policy.policyId,
      policyType: step.policy.policyType,
      policyVersion: step.policy.version,
      inputState,
      outputState,
      humanReadableSummary,
      durationMs,
    });

    currentState = nextState;
  });

  return { finalState: currentState, steps };
}
