# TLM Punch Processing Engine

Internal calculation engine for the TLM (Time & Labor Management) platform's punch-to-timesheet
pipeline: turns raw punches into rule-evaluated, payroll-ready timesheets.

This service is now called ONLY by the sibling [tlm-backend](../tlm-backend) service, as a trusted
service identity — not directly by end users. tlm-backend is the sole public owner of
Employee/EmployeeGroup/Site/Task/PayPeriodConfig/PayrollCalendar/Punch CRUD and punch ingestion;
this service just reads that same master data (via its own Mongoose connection into TLM's
database) to run the actual calculation, and exposes the processing-trigger and timesheet
view/void endpoints tlm-backend proxies to.

This service is also a **downstream consumer** of the sibling [TLM Rule Repository](../TLM)
service — it does not store or evaluate policies itself. For every punch it processes, it asks TLM
which rule groups apply to that employee/site/date (via TLM's layered assignment resolution) and
runs the resolved policies (overtime, meal/rest breaks, shift differentials, pay differentials,
rate rules, etc.) through its own local rule-type engine.

This service uses **two MongoDB connections**:
- TLM's own database (`tlm_rule_repository`) holds `Employee`, `EmployeeGroup`, `PayPeriodConfig`,
  `PayrollCalendar`, and `Punch` — client-owned master data owned and written EXCLUSIVELY by
  tlm-backend's own API. This service connects to that same database (via a second Mongoose
  connection, `RULE_REPO_MONGODB_URI`) purely to READ those collections for its own calculations;
  it has no routes of its own in front of them, and never writes to them itself (`Site` and `Task`
  aren't read here at all — punches carry their `siteId`/`task` as plain strings, so this engine
  never needs to look either up).
- This service's own database (`tlm_punch_processor`, `MONGODB_URI`) holds only its
  processing-specific state: `ProcessingLock`, `ProcessingRun`, `ProcessingAuditEntry`, and
  `Timesheet`.

See [`TEST_PLAN.md`](TEST_PLAN.md) for the full architecture and testing strategy, including the
processing pipeline, concurrency/locking design, and the rule-type processor archetypes.

## Requirements

- Node.js 20+
- MongoDB 6+ (local install, Docker, or Atlas) for this service's own processing state
- Access to TLM's own MongoDB database (`tlm_rule_repository`) — this service reads
  Employee/EmployeeGroup/PayPeriodConfig/PayrollCalendar/Punch there directly, so it must be the
  SAME database instance TLM itself uses, not a separate copy
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
# MONGODB_URI points) — this service reads Employee/EmployeeGroup/PayPeriodConfig/
# PayrollCalendar/Punch there directly, not in a database of its own.

npm run dev                 # starts the API on http://localhost:4100
```

Check it's up:

```bash
curl http://localhost:4100/health
```

### Setting up the Rule Repository service account

This service calls TLM's own API outbound (policy types, layered assignment resolution) using a
dedicated `PLATFORM_ADMIN` service-account user in TLM — not a human's login token. Unlike a
pre-minted JWT, this service logs into that account itself at runtime whenever its cached token is
missing or near expiry (see `src/clients/ruleRepositoryClient.ts`), so there's nothing to
periodically re-mint — just make sure the account exists and its credentials are in `.env`.
`npm run seed` automates this; to do it by hand against a running TLM instance:

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<TLM SEED_ADMIN_PASSWORD>"}'
# -> { "token": "<admin token>", "user": {...} }

curl -X POST http://localhost:4000/api/v1/users \
  -H "Authorization: Bearer <admin token>" -H "Content-Type: application/json" \
  -d '{"email":"svc-punch-processor@internal","password":"<a real password>","role":"PLATFORM_ADMIN"}'
# -> set RULE_REPO_SERVICE_ACCOUNT_EMAIL/PASSWORD in .env to this email/password
```

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
`JWT_SECRET` / `RULE_REPO_SERVICE_ACCOUNT_PASSWORD` values — the app refuses to boot on placeholder
secrets outside `NODE_ENV=development`/`test`, same as TLM.

## Environment variables

See [`.env.example`](.env.example) for the full list with explanations. Notable ones:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | This service's own MongoDB connection string — processing state only (ProcessingLock/ProcessingRun/ProcessingAuditEntry/Timesheet) |
| `RULE_REPO_MONGODB_URI` | TLM's own MongoDB connection string — Employee/EmployeeGroup/PayPeriodConfig/PayrollCalendar/Punch live there (owned by tlm-backend); must point at the SAME database TLM itself uses |
| `JWT_SECRET` | Must be the **same value** as TLM's `JWT_SECRET` — this service verifies the identical human-login JWTs TLM issues, it does not mint its own |
| `RULE_REPO_BASE_URL` | Base URL of the TLM API this service calls outbound (include `/api/v1`) |
| `RULE_REPO_SERVICE_ACCOUNT_EMAIL` / `_PASSWORD` | Credentials for a `PLATFORM_ADMIN` service-account user seeded in TLM, used only for this service's own outbound calls to TLM — this service logs in fresh on demand, so these never expire the way a pre-minted JWT would |
| `PROCESSING_CONCURRENCY` | How many employee+pay-period jobs run concurrently in a processing batch |
| `LOCK_LEASE_MS` | How long a `ProcessingLock` is held before the stale-lock reaper may reclaim it |
| `USER_PROFILE_CACHE_MS` | How long a cached TLM `GET /users/me` lookup (role/clientId/status) is trusted before re-checking |
| `CORS_ORIGIN` | Comma-separated allowlist of browser origins; unset allows all |

## Auth model

This service accepts human TLM-issued JWTs the same way it always has — verified locally against
`JWT_SECRET` (HS256, same secret and same tokens as TLM issues on login), with role/`clientId`/
account status resolved **live** from TLM's `GET /users/me` (this service has no `User` collection
of its own), cached per-token for `USER_PROFILE_CACHE_MS` (default 60s). What's changed is who is
expected to hold one: the only intended caller of `/processing/runs` and `/timesheets/*` now is
tlm-backend, authenticating with a dedicated `PLATFORM_ADMIN` service-account token (see "Setting
up the Rule Repository service account" above — tlm-backend's own equivalent account is
`PUNCH_PROCESSOR_SERVICE_ACCOUNT_EMAIL`/`_PASSWORD`, seeded the same way). This is an
**operational** boundary, not a code one: `authenticate` itself still just verifies *a* valid TLM
JWT and doesn't distinguish "a real end user" from "tlm-backend's service account" — nothing stops
a valid human JWT from calling these routes directly, tlm-backend is simply the only party expected
to hold a token for this purpose. `RULE_REPO_SERVICE_ACCOUNT_EMAIL`/`_PASSWORD` are the other
direction: used by THIS service, outbound, to log itself into TLM's API on demand
(`GET /policy-types`, `GET /assignments/resolve-layered`) — never accepted as an inbound credential.

Employee/Site/Task/EmployeeGroup/PayPeriodConfig/PayrollCalendar/Punch CRUD and punch ingestion —
along with their `PUNCH_INGEST_API_KEY` credential — have moved to tlm-backend entirely; this
service no longer has any routes for them.

## API surface

All routes below are mounted under `/api/v1`, except `/health` which is at the root. Both are
meant to be called by tlm-backend only (see "Auth model" above), not directly by end users.

| Resource | Routes |
|---|---|
| Processing | `POST /processing/runs` |
| Timesheets | `GET /timesheets`, `GET /timesheets/:id`, `GET /timesheets/:id/audit-trail`, `POST /timesheets/:id/void` |
| Health | `GET /health` — this service's own DB status, the rule-repo DB connection, plus a short-timeout, non-blocking reachability flag for TLM (`ruleRepository: "up"/"down"`); only this service's own DB state affects the HTTP status code |

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
