import { AssignmentTargetType, PolicyType } from "../types/domain";

// A minimal shape of the Policy documents this engine reads back from TLM — mirrors TLM's
// Policy envelope (src/models/policy.model.ts) exactly enough for the engine's own needs, without
// depending on TLM's Mongoose types directly (this is a separate service/repo).
export interface RemotePolicy {
  policyId: string;
  version: number;
  policyType: PolicyType;
  name: string;
  // Shape varies by policyType, exactly like TLM's own base Policy.rules.
  rules: any;
}

export interface Segment {
  startIso: string; // ISO instant, zoned to ctx.evaluationTz for all wall-clock math
  endIso: string;
  sourcePunchIds: string[];
  siteId: string;
  task: string;
  paid: boolean; // false for unpaid meal segments carved out of a work segment
  createdByPolicyId: string | null; // null for raw punch-derived segments
}

export interface HourBuckets {
  regularMinutes: number;
  otMinutes: number;
  dtMinutes: number;
}

export interface DifferentialApplication {
  policyId: string;
  policyType: "SHIFT_DIFFERENTIAL" | "NIGHT_DIFFERENTIAL" | "PAY_DIFFERENTIAL";
  band: { start: string; end: string } | { conditionCode: string }; // band-based vs condition-based
  minutesAffected: number;
  differentialType: "percent" | "flat";
  value: number;
  appliesToSegmentRefs: string[];
}

export interface Penalty {
  policyId: string;
  policyType: PolicyType;
  type: "premium_pay";
  hours: number;
  rate: "regular" | "overtime";
  reason: string;
}

export interface Violation {
  policyId: string;
  policyType: PolicyType;
  code: string;
  message: string;
  severity: "warning" | "review_required";
}

export interface FinalAmounts {
  regularAmount: number;
  otAmount: number;
  dtAmount: number;
  differentialAmount: number;
  premiumAmount: number;
  totalAmount: number;
}

export interface ProcessingState {
  day: { businessDate: string; timezone: string };
  rawSegments: Segment[]; // as-punched, tz-normalized, never mutated after ingestion
  workSegments: Segment[]; // rawSegments minus unpaid-meal carve-outs; mutated by meal/rest processors
  hourBuckets: HourBuckets; // overwritten by OVERTIME (idempotent-overwrite archetype)
  differentialApplications: DifferentialApplication[]; // appended/band-deduped (additive archetype)
  penalties: Penalty[]; // appended
  violations: Violation[]; // appended, informational, never blocks processing
  rate: { rateType: "hourly" | "salary"; baseRate: number; minimumWage: number }; // minimumWage tracks a running MAX (extremal archetype)
  amounts: FinalAmounts | null; // populated only by finalizeAmounts, after the whole pipeline runs
}

export interface SourceAssignmentTag {
  assignmentId: string;
  targetType: AssignmentTargetType;
  priority: number;
  ruleGroupId: string;
  ruleGroupVersion: number;
}

export interface WeekToDateContext {
  workweekKey: string;
  cumulativeRegularMinutesPriorDays: number;
  cumulativeOtMinutesPriorDays: number;
  consecutiveDaysWorked: number;
}

export interface ProcessingContext {
  clientId: string;
  employeeId: string;
  siteId: string;
  task: string;
  evaluationTz: string;
  sourceAssignment: SourceAssignmentTag;
  weekToDate: WeekToDateContext;
}

/**
 * Every rule-type processor implements this signature. Processors are pure functions returning a
 * NEW state object (shallow-spread, never mutate `state` in place) — this is what makes
 * before/after audit snapshotting trivial and lets each processor be unit-tested in isolation with
 * plain object fixtures, no DB.
 */
export type RuleProcessor = (state: ProcessingState, policy: RemotePolicy, ctx: ProcessingContext) => ProcessingState;

export function createInitialState(businessDate: string, timezone: string, rawSegments: Segment[]): ProcessingState {
  return {
    day: { businessDate, timezone },
    rawSegments,
    workSegments: rawSegments,
    hourBuckets: { regularMinutes: 0, otMinutes: 0, dtMinutes: 0 },
    differentialApplications: [],
    penalties: [],
    violations: [],
    rate: { rateType: "hourly", baseRate: 0, minimumWage: 0 },
    amounts: null,
  };
}
