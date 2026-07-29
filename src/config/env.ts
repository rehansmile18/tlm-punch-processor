import "dotenv/config";

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

// Same reasoning as TLM's env.ts: ANY environment other than an explicitly-declared local dev/test
// must supply real secrets, so a deploy that forgets NODE_ENV (or sets it to something
// unrecognized) refuses to boot on a placeholder JWT secret or service-account token.
const allowsInsecureDefaults = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const INSECURE_DEFAULTS = new Set(["dev-secret-change-me", "change-me-in-production", "change-me-immediately"]);

function resolveSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (!value) {
    if (!allowsInsecureDefaults) {
      throw new Error(
        `${name} must be set unless NODE_ENV is "development" or "test" (NODE_ENV=${process.env.NODE_ENV ?? "<unset>"})`
      );
    }
    return devFallback;
  }
  if (!allowsInsecureDefaults && INSECURE_DEFAULTS.has(value)) {
    throw new Error(`${name} is set to a known insecure default; set a real value before running outside local dev/test`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4100),
  // This service's OWN database — processing-only state: ProcessingLock, ProcessingRun,
  // ProcessingAuditEntry, Timesheet.
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/tlm_punch_processor",
  // The TLM Rule Repository's own MongoDB database. Employee, EmployeeGroup, Site, Task,
  // PayPeriodConfig, PayrollCalendar, and Punch all live THERE instead of this service's own
  // database — they're fundamentally client-owned master data that belongs alongside the Client
  // records TLM already owns, not processing state. See config/db.ts's `ruleRepoConnection`.
  ruleRepoMongoUri: process.env.RULE_REPO_MONGODB_URI ?? "mongodb://localhost:27017/tlm_rule_repository",
  // Must be the SAME secret TLM's JWT_SECRET is set to — this service verifies the identical
  // human-login JWTs TLM issues (see middleware/auth.ts), it does not mint its own.
  jwtSecret: resolveSecret("JWT_SECRET", "dev-secret-change-me"),
  nodeEnv,
  isProduction,

  // The Rule Repository this service is a downstream consumer of.
  ruleRepoBaseUrl: process.env.RULE_REPO_BASE_URL ?? "http://localhost:4000/api/v1",
  // A long-lived JWT for a PLATFORM_ADMIN service-account User seeded in TLM (see
  // src/utils/seed.ts and the README) — used only for this service's own outbound calls to TLM's
  // API (policy-types, assignments/resolve-layered), never exposed to this service's own callers.
  ruleRepoServiceJwt: resolveSecret("RULE_REPO_SERVICE_JWT", "dev-secret-change-me"),

  processingConcurrency: Number(process.env.PROCESSING_CONCURRENCY ?? 8),
  lockLeaseMs: Number(process.env.LOCK_LEASE_MS ?? 60_000),

  // How long a cached (role, clientId) lookup from TLM's GET /users/me is trusted before this
  // service re-checks it — bounds how stale a role/permission change can be seen as, without
  // hitting TLM on every single request.
  userProfileCacheMs: Number(process.env.USER_PROFILE_CACHE_MS ?? 60_000),
};

/**
 * Same fail-closed philosophy as resolveSecret above, applied to CORS: an unrestricted origin
 * policy is a fine local/dev default (requests still require a bearer token), but must be an
 * explicit choice — not a silent default — anywhere else.
 */
export function resolveCorsOrigins(): string[] | undefined {
  const configured = process.env.CORS_ORIGIN?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) return configured;
  if (!allowsInsecureDefaults) {
    throw new Error(
      `CORS_ORIGIN must be set unless NODE_ENV is "development" or "test" (NODE_ENV=${process.env.NODE_ENV ?? "<unset>"}) — an unrestricted CORS policy is not allowed outside local dev/test`
    );
  }
  return undefined;
}
