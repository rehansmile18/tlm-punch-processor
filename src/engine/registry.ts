import { PolicyType } from "../types/domain";
import { processCaMealBreak } from "./processors/caMealBreak";
import { processMealBreak } from "./processors/mealBreak";
import { processOvertime } from "./processors/overtime";
import { processPayDifferential } from "./processors/payDifferential";
import { processPaygroup } from "./processors/paygroup";
import { processRate } from "./processors/rate";
import { processRestBreak } from "./processors/restBreak";
import { processShift } from "./processors/shift";
import { processNightDifferential, processShiftDifferential } from "./processors/shiftDifferential";
import { RuleProcessor } from "./types";

/**
 * Maps every PolicyType to its rule processor. The Record<PolicyType, RuleProcessor> annotation
 * makes this exhaustive by construction — TypeScript will fail to compile if any PolicyType is
 * left unmapped.
 */
export const processorRegistry: Record<PolicyType, RuleProcessor> = {
  OVERTIME: processOvertime,
  MEAL_BREAK: processMealBreak,
  CA_MEAL_BREAK: processCaMealBreak,
  REST_BREAK: processRestBreak,
  SHIFT: processShift,
  SHIFT_DIFFERENTIAL: processShiftDifferential,
  NIGHT_DIFFERENTIAL: processNightDifferential,
  PAY_DIFFERENTIAL: processPayDifferential,
  RATE: processRate,
  PAYGROUP: processPaygroup,
};
