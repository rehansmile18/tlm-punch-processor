# Test Plan — Punch-to-Timesheet Processing Engine

Covers both pieces of this feature: the small additive change to the TLM Rule Repository (`GET /assignments/resolve-layered`), and the new `tlm-punch-processor` service. Mirrors the architecture in `/Users/rehan/.claude/plans/act-as-a-solution-peppy-hippo.md`.

Testing stack matches TLM's existing conventions: `vitest` + `mongodb-memory-server` (no real Mongo needed) + `supertest`, `tests/helpers.ts` for shared fixtures (`setupTestContext`, `authed(app, token)`, `login`, seeding). Rule-type processors are additionally unit-tested with **plain object fixtures, no DB at all** — they're pure functions.

Every phase below must pass `npm run lint && npx tsc --noEmit && npm test` before moving to the next (matches the gate already enforced across TLM/tlm-frontend this whole session).

---

## 1. TLM: `resolveAssignmentLayered` / `GET /assignments/resolve-layered`

Status: **done** — `tests/assignment.test.ts`, describe block `"assignment resolution: resolve-layered"`, 6 tests, all passing alongside the pre-existing 45 (51/51 total).

| # | Case | Assertion |
|---|---|---|
| 1 | Only an EMPLOYEE assignment matches | `layers.length === 1`, `targetType: "EMPLOYEE"` |
| 2 | Only a LOCATION (site) assignment matches | `layers.length === 1`, `targetType: "LOCATION"` |
| 3 | **Both** an employee and a site assignment apply to one punch | `layers.length === 2`, each layer's `assignment.priority` matches what was configured (20 vs 10) — proves layering doesn't collapse to a winner |
| 4 | A matched level's rule group has no live version (draft, never published) | That layer is present with `unresolved: true`, `ruleGroup: null` — call still returns 200 with the *other* layers intact, never fails the whole request |
| 5 | Nothing matches at all | `200` with `layers: []`, `consideredAssignments: 0` — deliberately NOT a 404 (unlike single-winner `/resolve`), since "no layer applies" is a valid, non-error outcome for a layered/optional design |
| 6 | Cross-tenant `clientId` | `403`, identical to the existing `/resolve` tenant guard |

Regression: all 45 pre-existing TLM tests (auth, client, policy, ruleGroup, tenant, profile) re-run unmodified and pass — confirms this was purely additive.

---

## 2. New service: master data (Employee, EmployeeGroup, Site, Task, PayPeriodConfig, PayrollCalendar)

Per-module CRUD test pattern (mirrors TLM's `client.test.ts`/`user`-style tests):

- Create/list/get/update happy path for each of the 6 collections.
- Tenant scoping: a `CLIENT_ADMIN` from client A cannot read/write client B's Employee/Site/Task/etc. (403), `PLATFORM_ADMIN` can operate across clients.
- Validation: reject malformed cadence/timezone values, missing required refs (e.g. `Employee.employeeGroupId` pointing at a non-existent group).
- `PayPeriodConfig` fallback: an `Employee` with no own `payPeriodConfigId` resolves its `EmployeeGroup`'s config; an employee with both uses its own (most-specific wins, 2-level fallback).

## 3. Punch ingestion

- Single `POST /punches`: valid punch accepted, `status: "open"` when no `clockOut` yet.
- `POST /punches/bulk`: mixed valid/invalid array returns partial success (`{accepted, rejected: [{index, error}]}`), not all-or-nothing.
- Rejects: `clockOut` before `clockIn` (negative duration), missing/invalid `timezone`, unknown `siteId`/`employeeId`.
- `PATCH /punches/:id` correction: creates the expected audit trail linkage and flags any already-`completed` `Timesheet` covering that punch as `stale: true` (does not silently reprocess).
- Auth: `PUNCH_INGEST` role can POST but not touch employee/site/rule config endpoints (403 on those).

## 4. Core engine — rule-type processors (pure-function unit tests, no DB)

One test file per processor, each covering every field/combination in that type's schema (per the plan's Part 3 archetypes):

- **OVERTIME**: no thresholds set (pass-through), daily-only threshold, daily+weekly interaction (regular minutes promoted to OT once the weekly cumulative crosses the threshold — assert `Math.floor`-correct boundary, not off-by-one), 7th-consecutive-day override (`consecutiveDaysWorked >= 6` triggers `otAfterHours`/`dtAfterHours` regardless of daily thresholds).
- **CA_MEAL_BREAK / MEAL_BREAK**: shift under the minimum length (no deduction), waiver-eligible short shift, on-duty meal allowed vs. not, second-meal-required long shift, penalty accrual shape.
- **REST_BREAK**: paid vs. unpaid, break count scales with `minutesOfWorkPerRestBreak`, penalty when a required break isn't represented in punches.
- **SHIFT**: below-minimum and above-maximum shift length both flag a `violation` (never blocks processing), split-shift premium trigger.
- **SHIFT_DIFFERENTIAL / NIGHT_DIFFERENTIAL** (shared processor factory — test both instantiations): non-overlapping band, overlapping-with-work-segment band, a band that wraps past midnight (split into two sub-ranges), two DIFFERENT policy types both claiming overlapping minutes (both survive — stacking), two applications of the SAME policyType claiming the same band (later replaces earlier — dedup, not double-pay).
- **PAY_DIFFERENTIAL**: matching `task`/`code` condition applies, non-matching silently skipped, multiple matching conditions stack.
- **RATE**: `minimumWage` running-max across layers — a lower-priority layer's higher minimum wage must survive even if a later, higher-priority layer specifies a lower number (extremal archetype, tested explicitly since this is the one type that does NOT follow simple last-wins).
- **PAYGROUP**: `payFrequency`/`workweekStart` read correctly into context; `defaultOvertimePolicyId` used only when no explicit OVERTIME policy resolved (fallback path).

Cross-cutting pipeline tests (still no DB — feed a hand-built flattened policy list into the pipeline function directly):
- Employee-layer (priority 20) + site-layer (priority 10) both containing an OVERTIME policy → site's runs first, employee's runs last and wins (category A behavior) — assert final `hourBuckets` reflects the employee policy's thresholds.
- Same setup but with SHIFT_DIFFERENTIAL instead → both differentials present in `differentialApplications` (category B — stacking, not override).
- `finalizeAmounts` is order-independent: run the same flattened policy list in two different valid orderings that don't affect precedence (e.g. swap two non-conflicting types) and assert identical final `amounts`.

## 5. Timezone & business-date correctness

- Punch fully within one day, one timezone → correct `businessDate`.
- Shift crossing midnight → `businessDate` = punch-**in** date (not split, not the punch-out date).
- Overnight time band (`22:00`–`06:00`) correctly split across the midnight boundary and both sub-ranges checked against a segment that also crosses midnight.
- DST transition day (spring-forward and fall-back, using a real US DST date) → segment duration and band-overlap minutes still compute correctly (this is exactly the class of bug naive UTC-offset math introduces — test explicitly, don't assume `date-fns-tz` "just works" without a concrete assertion).
- Timezone resolution fallback order: punch's own tz → Site.timezone → Employee.timezone → reject (never silently defaults to UTC/server-local) — one test per fallback level, plus the reject case.

## 6. Pay period resolution (`utils/payPeriod.ts`)

One test per cadence, plus boundary cases:
- **daily**: period = the single business date.
- **weekly**: a date mid-week resolves to the correct `weekStartDay`-anchored 7-day window; a date exactly ON the anchor day.
- **biweekly**: a date before the `anchorDate` still buckets correctly (`Math.floor` on a negative day-diff, not truncation — this is the specific off-by-one this plan calls out) + a date exactly on a 14-day boundary.
- **semi_monthly**: a date on the 15th (boundary), the 16th, the last day of a 28/29/30/31-day month (Feb non-leap, Feb leap, 30-day, 31-day — four month-length variants).
- **monthly**: December 31 → January 1 rollover; leap-year February.
- **salaried**: produces a `Timesheet` with `producesHourlyLines: false` and a single collapsed line, not per-day lines.
- Payable date: offset-mode with and without the weekend-roll rule (`prior_business_day`/`next_business_day`), explicit-`PayrollCalendar`-mode hit and miss (miss → clear config error, never a silently wrong guessed date).

## 7. Concurrency & locking

- Two sequential `acquireLock` calls for the same `(employeeId, payPeriodId)` — second one throws `LockConflictError` (maps to `409`).
- Two DIFFERENT employees' locks acquired concurrently — both succeed, proving no false contention.
- Heartbeat renews `expiresAt`; a lock whose heartbeat stops (simulate by not calling it) becomes eligible for the reaper after `LEASE_MS`.
- `reapStaleLocks` releases an expired `held` lock and marks its `ProcessingRun` `failed` — and does NOT touch a lock that's still within its lease.
- Release always happens on both success and thrown-error paths (assert via a processor stub that deliberately throws mid-pipeline — lock must still be released, not left `held`).
- **The concrete "same employee, two threads" requirement**: fire two concurrent `POST /processing/runs` for the same `employeeId`+`payPeriodId` (via `Promise.all`, not sequential awaits, to actually race them) — assert exactly one succeeds and the other comes back `skipped_locked` in the batch response, never both completing and never a corrupted/double-written `Timesheet`.
- Batch of N employees where one has a lock conflict — the other N-1 still complete; batch response partitions `completed/skipped_locked/failed` correctly, never fails the whole batch over one conflict.

## 8. Idempotency & versioning

- Same `idempotencyKey` submitted twice → second call returns the first run's id/status, does not start a second run.
- Reprocessing an already-`completed` employee+period → new `Timesheet` version created, prior version flipped to `superseded`, `supersedesTimesheetId` set correctly, `GET /timesheets` defaults to the latest non-superseded version.
- `PATCH /punches/:id` after finalization → affected timesheet gets `stale: true` but stays `completed` (no silent auto-reprocess); explicit `POST /timesheets/:id/reprocess` is what creates the superseding version.
- `POST /timesheets/:id/void` → distinct terminal status from `superseded`, and a payroll-export-style query (hypothetical/future) would need to exclude both but the test just asserts the status values and that void doesn't delete history.
- Simulated crash mid-pipeline (throw after some `ProcessingAudit` entries are written but before the final `Timesheet` write) → no `Timesheet` document exists for that run (never a half-written one), run marked `failed`, safe to retry.

## 9. API-level / auth / tenant tests (mirrors TLM's own auth/tenant test files)

- `authenticate` middleware here: valid TLM-issued JWT accepted; expired/garbage token rejected; role/clientId resolved via the cached `GET /users/me` call (assert a stale cache entry still respects the ~60s TTL, then refreshes).
- Tenant scoping ported check: a `CLIENT_ADMIN` cannot read/write another client's Employees/Sites/Punches/Timesheets (403 across the board, same pattern as TLM's `tenant.test.ts`).
- `/health`: reports the new service's own DB status AND a separate, non-blocking flag for TLM reachability — test both TLM-up and (mocked) TLM-down cases, confirming the health check itself never hangs waiting on the TLM probe past its short timeout.

## 10. End-to-end integration (the payoff test)

Full stack, both services' real HTTP APIs (TLM already running on :4000, new service started on its test port), `mongodb-memory-server` backing each independently:

1. Seed in TLM: a client, an `OVERTIME` global policy, a `SHIFT_DIFFERENTIAL` client policy, a `CA_MEAL_BREAK` client policy, two rule groups (one referencing the differential+meal policies for a site, one referencing overtime for a specific employee), an EMPLOYEE assignment (priority 20) and a LOCATION assignment (priority 10) both resolvable for the same employee+site+date.
2. Seed in the new service: matching `Employee` (referencing the site, a weekly `PayPeriodConfig`), `Site`, `Task`.
3. Submit a full week of punches for that employee at that site, including: a >40-hour week (to trigger weekly OT reclassification), at least one segment inside a night-differential band, one meal-break-eligible long shift, one intentionally missing punch-out day.
4. Trigger `POST /processing/runs` for the employee+week.
5. Assert: the `open` day is excluded and flagged for review (not silently dropped or guessed); the completed days' `Timesheet` lines carry correct `site/employee/task/rate/rateType/dailyAmount/additionalAmount/additionalHours/totalHours/totalAmount`, hand-calculated and compared exactly; `payDate` matches the configured weekly cadence + offset; the audit trail (`GET /timesheets/:id/audit-trail`) shows every pipeline step in priority order (site/LOCATION layer's policies before the employee/EMPLOYEE layer's, per the configured priorities) with the correct `humanReadableSummary` for at least the OT reclassification and the night-differential application.
6. Re-run the same `POST /processing/runs` with the same `idempotencyKey` → confirms idempotent no-op (same run returned, no duplicate `Timesheet`).
7. Correct one punch, call `POST /timesheets/:id/reprocess` → new version supersedes the old, both remain queryable, audit trail for the OLD run is untouched.

## Out of scope for this plan (explicitly, not by oversight)

- Load/performance testing (throughput targets for large batches) — flag as a follow-up once real volume expectations are known.
- Any UI for reviewing timesheets/audit trails (this plan is API-only, matching TLM's own admin-API-first pattern before `tlm-frontend` was layered on top).
- Cross-instance horizontal scaling tests (the lock design supports it per Part 4 of the architecture plan, but only one instance is exercised here — multi-instance is a deployment-time concern, not a v1 correctness concern).
