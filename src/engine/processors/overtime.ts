import { HourBuckets, RuleProcessor, Segment } from "../types";

// TLM's OVERTIME policy.rules shape (policy.rules is typed `any` in RemotePolicy — cast locally).
interface OvertimeRules {
  workweekStartDay: string; // informational only for this processor
  dailyOTThresholdHours: number | null;
  dailyDTThresholdHours: number | null;
  weeklyOTThresholdHours: number;
  seventhConsecutiveDayRule: {
    enabled: boolean;
    otAfterHours: number;
    dtAfterHours: number | null;
  };
}

function sumMinutes(segments: Segment[]): number {
  return segments.reduce(
    (total, seg) => total + (new Date(seg.endIso).getTime() - new Date(seg.startIso).getTime()) / 60000,
    0,
  );
}

// Splits totalMinutes into regular/OT/DT bands using two ascending cut points. Either cut point may
// be null, meaning "no boundary there" — e.g. otThreshold=null && dtThreshold=null leaves everything
// regular; otThreshold set && dtThreshold=null pushes everything past otThreshold into OT with no DT.
function splitByThresholds(totalMinutes: number, otThreshold: number | null, dtThreshold: number | null): HourBuckets {
  if (otThreshold == null && dtThreshold == null) {
    return { regularMinutes: totalMinutes, otMinutes: 0, dtMinutes: 0 };
  }

  if (otThreshold == null && dtThreshold != null) {
    // No OT tier configured — the DT threshold alone splits regular/DT.
    const regularMinutes = Math.min(totalMinutes, dtThreshold);
    const dtMinutes = Math.max(0, totalMinutes - dtThreshold);
    return { regularMinutes, otMinutes: 0, dtMinutes };
  }

  const ot = otThreshold as number;
  const regularMinutes = Math.min(totalMinutes, ot);
  const remainingAfterRegular = Math.max(0, totalMinutes - ot);

  if (dtThreshold == null) {
    return { regularMinutes, otMinutes: remainingAfterRegular, dtMinutes: 0 };
  }

  const otSpan = Math.max(0, dtThreshold - ot);
  const otMinutes = Math.min(remainingAfterRegular, otSpan);
  const dtMinutes = Math.max(0, totalMinutes - dtThreshold);
  return { regularMinutes, otMinutes, dtMinutes };
}

/**
 * IDEMPOTENT OVERWRITE archetype: recomputes state.hourBuckets from scratch based on
 * state.workSegments and ctx.weekToDate, and REPLACES state.hourBuckets entirely — it never adds to
 * whatever was already there. If multiple assignment layers each carry an OVERTIME policy, the one
 * that runs later in the pipeline simply wins; no merge logic is needed because every invocation
 * recomputes fresh from workSegments.
 */
export const processOvertime: RuleProcessor = (state, policy, ctx) => {
  const rules = policy.rules as OvertimeRules;

  const totalMinutes = sumMinutes(state.workSegments);

  const seventhDayRule = rules.seventhConsecutiveDayRule;
  const seventhDayOverrideApplies = seventhDayRule?.enabled === true && ctx.weekToDate.consecutiveDaysWorked >= 6;

  if (seventhDayOverrideApplies) {
    const otThreshold = seventhDayRule.otAfterHours * 60;
    const dtThreshold = seventhDayRule.dtAfterHours != null ? seventhDayRule.dtAfterHours * 60 : null;
    // The 7th-consecutive-day override is final for the day — daily/weekly logic below never runs.
    const finalBuckets = splitByThresholds(totalMinutes, otThreshold, dtThreshold);
    return { ...state, hourBuckets: finalBuckets };
  }

  const dailyOtAfter = rules.dailyOTThresholdHours != null ? rules.dailyOTThresholdHours * 60 : null;
  const dailyDtAfter = rules.dailyDTThresholdHours != null ? rules.dailyDTThresholdHours * 60 : null;
  const dailyBuckets = splitByThresholds(totalMinutes, dailyOtAfter, dailyDtAfter);

  // Weekly reclassification: promote regular minutes into OT once the cumulative week-to-date
  // regular total (prior days + today's regular candidate) crosses the weekly OT threshold.
  const weeklyThresholdMinutes = rules.weeklyOTThresholdHours * 60;
  const overWeekly = Math.max(
    0,
    ctx.weekToDate.cumulativeRegularMinutesPriorDays + dailyBuckets.regularMinutes - weeklyThresholdMinutes,
  );
  const promoted = Math.min(overWeekly, dailyBuckets.regularMinutes);

  const finalBuckets: HourBuckets = {
    regularMinutes: dailyBuckets.regularMinutes - promoted,
    otMinutes: dailyBuckets.otMinutes + promoted,
    dtMinutes: dailyBuckets.dtMinutes,
  };

  return { ...state, hourBuckets: finalBuckets };
};
