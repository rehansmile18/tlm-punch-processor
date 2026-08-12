import { env } from "../config/env";
import { HttpError } from "../utils/errors";
import { AssignmentTargetType, PolicyType } from "../types/domain";
import { RemotePolicy } from "../engine/types";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;

// Refresh this many ms before the cached token's real expiry, so an in-flight request never races
// a token that's valid when read but expired by the time the outbound call actually lands.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60_000;
// If the token's exp claim can't be read for any reason, treat it as short-lived rather than
// caching something indefinitely on a parsing failure.
const FALLBACK_TOKEN_TTL_MS = 5 * 60_000;

let cachedServiceToken: { token: string; expiresAt: number } | null = null;

function decodeJwtExpiryMs(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + FALLBACK_TOKEN_TTL_MS;
  } catch {
    return Date.now() + FALLBACK_TOKEN_TTL_MS;
  }
}

async function loginServiceAccount(): Promise<string> {
  const res = await fetch(`${env.ruleRepoBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.ruleRepoServiceAccountEmail, password: env.ruleRepoServiceAccountPassword }),
  });
  if (!res.ok) {
    throw new HttpError(502, `Could not authenticate this service's own account against the Rule Repository: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/**
 * Logs this service's own service-account identity into TLM on demand rather than relying on a
 * pre-minted, statically-configured JWT — that design expired every ~12h (TLM's own
 * JWT_EXPIRES_IN) and needed manual re-minting. Cached in memory, refreshed proactively before
 * expiry and reactively on a 401 from the Rule Repository (see callRuleRepo's retry below).
 */
async function getServiceToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedServiceToken && cachedServiceToken.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cachedServiceToken.token;
  }
  const token = await loginServiceAccount();
  cachedServiceToken = { token, expiresAt: decodeJwtExpiryMs(token) };
  return token;
}

export interface PolicyTypeSchema {
  policyType: PolicyType;
  description: string;
  rulesSchema: unknown;
}

export interface ResolveLayeredParams {
  clientId: string;
  employeeId: string;
  date: string; // "YYYY-MM-DD"
  locationId?: string;
  paygroupId?: string;
  departmentId?: string;
  state?: string;
}

export interface ResolvedLayer {
  targetType: AssignmentTargetType;
  assignment: { _id: string; priority: number; ruleGroupId: string };
  ruleGroup: { ruleGroupId: string; version: number } | null;
  policies: RemotePolicy[];
  unresolvedRefs: unknown[];
  unresolved?: true;
}

export interface ResolveLayeredResult {
  layers: ResolvedLayer[];
  consideredAssignments: number;
}

/**
 * Thin HTTP client for this service's single upstream dependency: the TLM Rule Repository.
 * Authenticates every call with a dedicated PLATFORM_ADMIN service-account identity (see
 * getServiceToken above) — a completely separate credential from the human-login JWTs this
 * service's own `authenticate` middleware validates (see middleware/auth.ts).
 */
async function callRuleRepo<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(`${env.ruleRepoBaseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  let lastError: unknown;
  let forceTokenRefresh = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const token = await getServiceToken(forceTokenRefresh);
      forceTokenRefresh = false;
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        // Our own service-account token was rejected mid-cache-window (clock skew, an
        // out-of-band revocation) — force a fresh login and retry, rather than surfacing this as
        // a caller-facing error; it has nothing to do with the ORIGINAL caller's own token.
        if (res.status === 401 && attempt < MAX_RETRIES) {
          forceTokenRefresh = true;
          lastError = new Error("Rule Repository rejected our service-account token; retrying with a fresh one");
          continue;
        }
        // 4xx is otherwise a caller/config mistake — retrying won't help, surface immediately.
        if (res.status < 500) {
          const body = await res.text();
          throw new HttpError(502, `Rule Repository rejected ${path}: ${res.status} ${body.slice(0, 300)}`);
        }
        throw new Error(`Rule Repository ${path} returned ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (err instanceof HttpError) throw err; // don't retry a definitive 4xx
      // otherwise fall through and retry (network error, timeout, 5xx, or a forced token refresh)
    }
  }
  throw new HttpError(
    502,
    `Rule Repository unreachable after ${MAX_RETRIES + 1} attempts calling ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

export const ruleRepositoryClient = {
  getPolicyTypes: (): Promise<{ policyTypes: PolicyTypeSchema[] }> => callRuleRepo("/policy-types"),

  resolveLayered: (params: ResolveLayeredParams): Promise<ResolveLayeredResult> =>
    callRuleRepo("/assignments/resolve-layered", {
      clientId: params.clientId,
      employeeId: params.employeeId,
      date: params.date,
      locationId: params.locationId,
      paygroupId: params.paygroupId,
      departmentId: params.departmentId,
      state: params.state,
    }),

  /** Short-timeout, non-blocking reachability probe used by this service's own GET /health. */
  healthCheck: async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const res = await fetch(`${env.ruleRepoBaseUrl.replace(/\/api\/v1$/, "")}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  },
};
