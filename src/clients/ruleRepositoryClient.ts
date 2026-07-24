import { env } from "../config/env";
import { HttpError } from "../utils/errors";
import { AssignmentTargetType, PolicyType } from "../types/domain";
import { RemotePolicy } from "../engine/types";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;

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
 * Authenticates every call with the dedicated PLATFORM_ADMIN service-account JWT (RULE_REPO_SERVICE_JWT)
 * — a completely separate credential from the human-login JWTs this service's own `authenticate`
 * middleware validates (see middleware/auth.ts).
 */
async function callRuleRepo<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(`${env.ruleRepoBaseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${env.ruleRepoServiceJwt}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        // 4xx is a caller/config mistake — retrying won't help, surface immediately.
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
      // otherwise fall through and retry (network error, timeout, 5xx)
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
