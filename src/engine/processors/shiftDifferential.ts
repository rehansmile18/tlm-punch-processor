import { DifferentialApplication, ProcessingState, RemotePolicy, RuleProcessor, Segment } from "../types";

// SHIFT_DIFFERENTIAL and NIGHT_DIFFERENTIAL share this exact rules shape (mirrors TLM's own
// polymorphic Policy.rules for these two policy types) — cast policy.rules locally rather than
// widening RemotePolicy itself.
interface TimeBand {
  start: string; // "HH:mm"
  end: string; // "HH:mm" — may be LESS than start, meaning the band wraps past midnight
  differentialType: "percent" | "flat";
  value: number;
}

interface TimeBandRules {
  timeBands: TimeBand[];
}

const MINUTES_PER_DAY = 24 * 60;
const DAY_SHIFTS = [-MINUTES_PER_DAY, 0, MINUTES_PER_DAY];

function parseHHMM(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

// The engine normalizes Segment startIso/endIso to ctx.evaluationTz at ingestion, so for this pure
// computation we can read the wall-clock HH:mm portion straight off the ISO instant via its UTC
// getters (no timezone-library conversion needed here).
function minutesSinceMidnightUtc(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

function segmentDurationMinutes(seg: Segment): number {
  return (new Date(seg.endIso).getTime() - new Date(seg.startIso).getTime()) / 60000;
}

function segmentRef(seg: Segment): string {
  return seg.sourcePunchIds.length > 0 ? seg.sourcePunchIds.join(",") : `${seg.startIso}|${seg.endIso}`;
}

// A band whose end wraps past midnight (end < start) is split into two same-day sub-ranges: the
// "tonight" portion up to 24:00, and the "tomorrow" portion from 00:00. Both are expressed in plain
// 0..1440 minutes-of-day coordinates; bandOverlapMinutes below tries each sub-range shifted by a
// whole day in either direction so it lines up correctly against a segment regardless of which
// calendar day the segment's own start falls on, or whether the segment itself crosses midnight.
function bandSubRanges(band: TimeBand): Array<[number, number]> {
  const start = parseHHMM(band.start);
  const end = parseHHMM(band.end);
  if (end >= start) {
    return [[start, end]];
  }
  return [
    [start, MINUTES_PER_DAY],
    [0, end],
  ];
}

function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function bandOverlapMinutes(segStart: number, segEnd: number, band: TimeBand): number {
  let total = 0;
  for (const [subStart, subEnd] of bandSubRanges(band)) {
    for (const shift of DAY_SHIFTS) {
      total += overlapMinutes(segStart, segEnd, subStart + shift, subEnd + shift);
    }
  }
  return total;
}

function isBandKeyed(band: DifferentialApplication["band"]): band is { start: string; end: string } {
  return "start" in band;
}

function sameBand(a: DifferentialApplication, b: DifferentialApplication): boolean {
  if (a.policyType !== b.policyType) return false;
  if (!isBandKeyed(a.band) || !isBandKeyed(b.band)) return false;
  return a.band.start === b.band.start && a.band.end === b.band.end;
}

// Additive archetype with same-type/same-band dedup: incoming applications replace any existing
// application that shares both policyType and band (last-write-wins per band); anything else
// (different policyType, or same policyType but a different band) stacks alongside what's there.
function mergeDifferentialApplications(
  existing: DifferentialApplication[],
  incoming: DifferentialApplication[]
): DifferentialApplication[] {
  const kept = existing.filter((old) => !incoming.some((next) => sameBand(old, next)));
  return [...kept, ...incoming];
}

function createTimeBandProcessor(policyType: "SHIFT_DIFFERENTIAL" | "NIGHT_DIFFERENTIAL"): RuleProcessor {
  return (state: ProcessingState, policy: RemotePolicy): ProcessingState => {
    const rules = policy.rules as TimeBandRules;
    const bands = rules.timeBands ?? [];

    const newApplications: DifferentialApplication[] = [];

    for (const band of bands) {
      let minutesAffected = 0;
      const appliesToSegmentRefs: string[] = [];

      for (const seg of state.workSegments) {
        const segStart = minutesSinceMidnightUtc(seg.startIso);
        const segEnd = segStart + segmentDurationMinutes(seg);
        const overlap = bandOverlapMinutes(segStart, segEnd, band);
        if (overlap > 0) {
          minutesAffected += overlap;
          appliesToSegmentRefs.push(segmentRef(seg));
        }
      }

      if (minutesAffected > 0) {
        newApplications.push({
          policyId: policy.policyId,
          policyType,
          band: { start: band.start, end: band.end },
          minutesAffected,
          differentialType: band.differentialType,
          value: band.value,
          appliesToSegmentRefs,
        });
      }
    }

    return {
      ...state,
      differentialApplications: mergeDifferentialApplications(state.differentialApplications, newApplications),
    };
  };
}

export const processShiftDifferential: RuleProcessor = createTimeBandProcessor("SHIFT_DIFFERENTIAL");
export const processNightDifferential: RuleProcessor = createTimeBandProcessor("NIGHT_DIFFERENTIAL");
