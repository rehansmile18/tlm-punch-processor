# TLM Punch Processing Engine

Backend service for the TLM (Time & Labor Management) platform's punch-to-timesheet pipeline:
ingests employee time punches (from kiosks/upstream time-clock systems or directly via the API),
and turns them into rule-evaluated, payroll-ready timesheets.

This service is a **downstream consumer** of the sibling [TLM Rule Repository](../TLM) service —
it does not store or evaluate policies itself. For every punch it processes, it asks TLM which
rule groups apply to that employee/site/date (via TLM's layered assignment resolution) and runs
the resolved policies (overtime, meal/rest breaks, shift differentials, pay differentials, rate
rules, etc.) through its own local rule-type engine.

This service uses **two MongoDB connections**:
- TLM's own database (`tlm_rule_repository`) holds `Employee`, `Site`, `Task`, `EmployeeGroup`,
  `PayPeriodConfig`, `PayrollCalendar`, and `Punch` — client-owned master data that belongs
  alongside the `Client`/`User`/`Policy` records TLM already owns. This service connects to that
  same database (via a second Mongoose connection, `RULE_REPO_MONGODB_URI`) purely to refer to
  those collections; it doesn't own, migrate, or duplicate them.
- This service's own database (`tlm_punch_processor`, `MONGODB_URI`) holds only its
  processing-specific state: `ProcessingLock`, `ProcessingRun`, `ProcessingAuditEntry`, and
  `Timesheet`.

See [`TEST_PLAN.md`](TEST_PLAN.md) for the full architecture and testing strategy, including the
processing pipeline, concurrency/locking design, and the rule-type processor archetypes.

## Requirements

- Node.js 20+
- MongoDB 6+ (local install, Docker, or Atlas) for this service's own processing state
- Access to TLM's own MongoDB database (`tlm_rule_repository`) — this service reads/writes
  Employee/EmployeeGroup/Site/Task/PayPeriodConfig/PayrollCalendar/Punch there directly, so it
  must be the SAME database instance TLM itself uses, not a separate copy
- A reachable TLM Rule Repository instance (for policy resolution and the outbound half of
  `/health`)

## Quick start (local Node + local/Docker MongoDB)

```bash
npm install
cp .env.example .env        # edit if you're not using the defaults

# Start this service's own MongoDB if you don't already have one running (bound to localhost only):
docker run -d --name tlm-punch-mongo -p 127.0.0.1:27018:27017 mongo:7
# then set MONGODB_URI=mongodb://localhost:27018/tlm_punch_processor in .env

# Point RULE_REPO_MONGODB_URI in .env at TLM's OWN MongoDB instance/database (wherever TLM's own
# MONGODB_URI points) — this service reads/writes Employee/Site/Task/EmployeeGroup/
# PayPeriodConfig/PayrollCalendar/Punch there directly, not in a database of its own.

npm run dev                 # starts the API on http://localhost:4100
```

Check it's up:

```bash
curl http://localhost:4100/health
```

### Getting a `RULE_REPO_SERVICE_JWT`

This service calls TLM's own API outbound (policy types, layered assignment resolution) using a
dedicated `PLATFORM_ADMIN` service-account user in TLM — not a human's login token. Concretely,
against a running TLM instance:

```bash
# 1. Log in as TLM's existing PLATFORM_ADMIN (from TLM's own `npm run seed`, or any admin you
#    already have), then create a dedicated service-account user for this purpose:
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<TLM SEED_ADMIN_PASSWORD>"}'
# -> { "token": "<admin token>", "user": {...} }

curl -X POST http://localhost:4000/api/v1/users \
  -H "Authorization: Bearer <admin token>" -H "Content-Type: application/json" \
  -d '{"email":"punch-processor-svc@tlm.local","password":"<a real password>","role":"PLATFORM_ADMIN"}'

# 2. Log in as that new service-account user — the returned token is the value for
#    RULE_REPO_SERVICE_JWT:
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"punch-processor-svc@tlm.local","password":"<a real password>"}'
```

TLM's tokens expire after `JWT_EXPIRES_IN` (TLM default: 12h), and TLM has no refresh-token
mechanism today, so a token minted this way is **not** truly permanent — for anything beyond quick
local testing, either re-run step 2 periodically to mint a fresh token, or set a longer
`JWT_EXPIRES_IN` on the TLM side for this specific service account.

```bash
npm test                    # vitest + mongodb-memory-server, no external database needed
npm run lint
npm run typecheck
```

## Quick start (Docker Compose — API + its own MongoDB together)

```bash
docker compose up -d --build
```

This brings up this service's own MongoDB (bound to `127.0.0.1:27018`, holding only this service's
processing state) and the API (bound to `127.0.0.1:4100`). By default it assumes a TLM instance is
reachable on the host at `http://host.docker.internal:4000/api/v1` (e.g. TLM's own compose stack,
or a bare `npm run dev`, running alongside this one) — override `RULE_REPO_BASE_URL` if yours
lives elsewhere. It also assumes TLM's own MongoDB is reachable on the host at
`host.docker.internal:27017` with TLM's own compose-default credentials — override
`RULE_REPO_MONGODB_URI` if TLM's database lives elsewhere or uses different credentials. See the
comments in `docker-compose.yml` for how to point both at a real TLM instance and supply real
`JWT_SECRET` / `RULE_REPO_SERVICE_JWT` / `PUNCH_INGEST_API_KEY` values — the app refuses to boot on
placeholder secrets outside `NODE_ENV=development`/`test`, same as TLM.

## Environment variables

See [`.env.example`](.env.example) for the full list with explanations. Notable ones:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | This service's own MongoDB connection string — processing state only (ProcessingLock/ProcessingRun/ProcessingAuditEntry/Timesheet) |
| `RULE_REPO_MONGODB_URI` | TLM's own MongoDB connection string — Employee/EmployeeGroup/Site/Task/PayPeriodConfig/PayrollCalendar/Punch live there; must point at the SAME database TLM itself uses |
| `JWT_SECRET` | Must be the **same value** as TLM's `JWT_SECRET` — this service verifies the identical human-login JWTs TLM issues, it does not mint its own |
| `RULE_REPO_BASE_URL` | Base URL of the TLM API this service calls outbound (include `/api/v1`) |
| `RULE_REPO_SERVICE_JWT` | Long-lived JWT for a `PLATFORM_ADMIN` service-account user seeded in TLM, used only for this service's own outbound calls to TLM |
| `PUNCH_INGEST_API_KEY` | Shared secret for kiosk/upstream time-clock systems submitting punches — a separate auth path from human JWTs |
| `PROCESSING_CONCURRENCY` | How many employee+pay-period jobs run concurrently in a processing batch |
| `LOCK_LEASE_MS` | How long a `ProcessingLock` is held before the stale-lock reaper may reclaim it |
| `USER_PROFILE_CACHE_MS` | How long a cached TLM `GET /users/me` lookup (role/clientId/status) is trusted before re-checking |
| `CORS_ORIGIN` | Comma-separated allowlist of browser origins; unset allows all |

## Auth model

This service accepts **three distinct credential types**, each for a different caller:

1. **Human TLM-issued JWT** — normal API use (Employee/Site/Task/EmployeeGroup/PayPeriodConfig/
   PayrollCalendar endpoints, and punches). Verified locally against `JWT_SECRET` (HS256, same
   secret and same tokens as TLM issues on login), which proves *who* cheaply with no network
   call. Role, `clientId`, and account status are then resolved **live** from TLM's
   `GET /users/me` — this service has no `User` collection of its own — cached per-token for
   `USER_PROFILE_CACHE_MS` (default 60s) so a role change in TLM propagates here quickly without
   hitting TLM on every request.
2. **`RULE_REPO_SERVICE_JWT`** — used the other direction: by this service, outbound, to
   authenticate its own calls to TLM's API (`GET /policy-types`, `GET
   /assignments/resolve-layered`). It is never accepted as an inbound credential from this
   service's own callers.
3. **`PUNCH_INGEST_API_KEY`** — a narrower credential for kiosk/upstream time-clock systems,
   sent as the `x-punch-ingest-key` header on punch endpoints only. It authenticates as a
   synthetic `PUNCH_INGEST` principal that can create/read/correct punches but cannot touch
   employee/site/rule-config endpoints, and isn't scoped to a single client (every punch write
   must carry its own `clientId` in the body). A request without this header falls through to
   the normal human-JWT check, so a `CLIENT_ADMIN`/`PLATFORM_ADMIN` can also submit punches
   directly without a separate credential.

## API surface

All routes below are mounted under `/api/v1`, except `/health` which is at the root. This
reflects what's actually registered in `src/app.ts` and the individual `*.routes.ts` files as of
this writing — modules marked **not yet implemented** are wired into `app.ts` as empty stub
routers so the app resolves, but have no live routes.

| Resource | Routes | Auth |
|---|---|---|
| Employees | `GET /employees`, `GET /employees/:id`, `POST /employees`, `PATCH /employees/:id` | human JWT |
| Employee groups | `GET /employee-groups`, `GET /employee-groups/:id`, `POST /employee-groups`, `PATCH /employee-groups/:id` | human JWT |
| Sites | `GET /sites`, `GET /sites/:id`, `POST /sites`, `PATCH /sites/:id` | human JWT |
| Tasks | `GET /tasks`, `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id` | human JWT |
| Pay period configs | `GET /pay-period-configs`, `GET /pay-period-configs/:id`, `POST /pay-period-configs`, `PATCH /pay-period-configs/:id` | human JWT |
| Payroll calendars | `GET /payroll-calendars`, `GET /payroll-calendars/:id`, `POST /payroll-calendars`, `PATCH /payroll-calendars/:id` | human JWT |
| Punches | `POST /punches`, `POST /punches/bulk`, `GET /punches`, `GET /punches/:id`, `PATCH /punches/:id` (correction) | punch-ingest key **or** human JWT |
| Processing | *not yet implemented* — `processing.routes.ts` is currently an empty stub. Planned: `POST /processing/runs`, `GET /processing/runs/:runId`, `POST /processing/runs/:runId/cancel` | — |
| Timesheets | *not yet implemented* — `timesheet.routes.ts` is currently an empty stub. Planned: `GET /timesheets`, `GET /timesheets/:id`, `GET /timesheets/:id/audit-trail`, `POST /timesheets/:id/reprocess`, `POST /timesheets/:id/void` | — |
| Health | `GET /health` — this service's own DB status, plus a short-timeout, non-blocking reachability flag for TLM (`ruleRepository: "up"/"down"`); only this service's own DB state affects the HTTP status code | none |

Note that the underlying engine and concurrency-safety pieces the Processing/Timesheet endpoints
will sit on top of — the rule-type processors, the pipeline, and the `ProcessingLock` model/service
— already exist in `src/engine/` and `src/modules/processing/lock.service.ts`; what's missing is
the HTTP layer wiring them up.

## Architecture notes

- **Concurrency safety**: a `ProcessingLock` (unique partial index on `{employeeId, payPeriodId,
  status: "held"}`) ensures the same employee+pay-period is never processed twice concurrently —
  acquisition is a single atomic insert that either succeeds or fails, with no separate
  check-then-insert race window. Different employees process in parallel, bounded by
  `PROCESSING_CONCURRENCY` (via `p-limit`). A heartbeat renews a held lock's lease; a lock whose
  heartbeat stops (its holder crashed) becomes eligible for a reaper to release after
  `LOCK_LEASE_MS`, marking the associated `ProcessingRun` `failed` so it's visible and safely
  retryable.
- See [`TEST_PLAN.md`](TEST_PLAN.md) for the complete testing strategy, including every rule-type
  processor's archetypes, timezone/business-date correctness, pay-period resolution per cadence,
  and the full concurrency/idempotency/versioning test matrix.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the API with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build (`dist/server.js`) |
| `npm run typecheck` | Type-check `src/` and `tests/` with no emit |
| `npm run lint` | ESLint over the project |
| `npm test` | Run the automated test suite (`vitest` + ephemeral in-memory MongoDB — no external database needed) |

## Docker

```bash
docker compose up -d --build
```

Brings up this service's own MongoDB and the API — see "Quick start (Docker Compose)" above for
what's configured by default and how to point it at a real TLM instance and real secrets.
