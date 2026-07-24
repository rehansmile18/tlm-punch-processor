// Same three roles as TLM, plus PUNCH_INGEST — a narrow role for kiosk/upstream time-clock
// credentials that may only submit punches, never touch rule/employee/site configuration.
export const USER_ROLES = ["PLATFORM_ADMIN", "CLIENT_ADMIN", "VIEWER", "PUNCH_INGEST"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CADENCES = ["daily", "weekly", "biweekly", "semi_monthly", "monthly", "salaried"] as const;
export type Cadence = (typeof CADENCES)[number];

export const PAY_DATE_WEEKEND_RULES = ["none", "prior_business_day", "next_business_day"] as const;
export type PayDateWeekendRule = (typeof PAY_DATE_WEEKEND_RULES)[number];

export const TIMESHEET_STATUSES = ["draft", "completed", "superseded", "voided", "failed"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export const PROCESSING_RUN_STATUSES = ["queued", "processing", "completed", "completed_with_errors", "failed", "canceled"] as const;
export type ProcessingRunStatus = (typeof PROCESSING_RUN_STATUSES)[number];

export const PROCESSING_ITEM_STATUSES = ["completed", "skipped_locked", "failed"] as const;
export type ProcessingItemStatus = (typeof PROCESSING_ITEM_STATUSES)[number];

// Mirrors TLM's src/types/domain.ts exactly — this service reads Policy docs of these types back
// from the Rule Repository and must recognize the same discriminator values.
export const POLICY_TYPES = [
  "OVERTIME",
  "MEAL_BREAK",
  "REST_BREAK",
  "SHIFT",
  "SHIFT_DIFFERENTIAL",
  "PAY_DIFFERENTIAL",
  "NIGHT_DIFFERENTIAL",
  "PAYGROUP",
  "RATE",
  "CA_MEAL_BREAK",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

// Mirrors TLM's AssignmentTargetType — used here purely to tag which layer a resolved rule group
// came from (EMPLOYEE vs LOCATION, primarily; PAYGROUP/DEPARTMENT/STATE pass through if TLM ever
// resolves them for a punch too).
export const ASSIGNMENT_TARGET_TYPES = ["EMPLOYEE", "PAYGROUP", "LOCATION", "DEPARTMENT", "STATE"] as const;
export type AssignmentTargetType = (typeof ASSIGNMENT_TARGET_TYPES)[number];
