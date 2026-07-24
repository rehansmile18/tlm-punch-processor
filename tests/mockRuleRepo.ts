// Installs a single global fetch() mock for the whole test run, dispatched by URL path, so this
// service's test suite never needs a real TLM instance running. Individual tests register/clear
// handlers via the exported functions rather than each patching global fetch themselves — avoids
// forgetting to restore it and leaking a stub across unrelated test files.

export interface MockProfile {
  role: "PLATFORM_ADMIN" | "CLIENT_ADMIN" | "VIEWER";
  clientId: string | null;
  status?: "active" | "disabled";
}

type ResolveLayeredHandler = (url: URL) => unknown;
type PolicyTypesHandler = () => unknown;

const profilesByToken = new Map<string, MockProfile>();
let resolveLayeredHandler: ResolveLayeredHandler | null = null;
let policyTypesHandler: PolicyTypesHandler | null = null;

export function registerMockProfile(token: string, profile: MockProfile): void {
  profilesByToken.set(token, profile);
}

export function setMockResolveLayeredHandler(handler: ResolveLayeredHandler | null): void {
  resolveLayeredHandler = handler;
}

export function setMockPolicyTypesHandler(handler: PolicyTypesHandler | null): void {
  policyTypesHandler = handler;
}

export function resetMockRuleRepo(): void {
  profilesByToken.clear();
  resolveLayeredHandler = null;
  policyTypesHandler = null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function extractBearerToken(init: RequestInit | undefined): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  const record = headers as Record<string, string>;
  const raw = record.Authorization ?? record.authorization;
  if (!raw?.startsWith("Bearer ")) return null;
  return raw.slice("Bearer ".length);
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export function installMockRuleRepoFetch(): void {
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (url.pathname.endsWith("/users/me")) {
      const token = extractBearerToken(init);
      const profile = token ? profilesByToken.get(token) : undefined;
      if (!profile) return jsonResponse({ error: "Unauthorized" }, 401);
      return jsonResponse({ role: profile.role, clientId: profile.clientId, status: profile.status ?? "active" });
    }

    if (url.pathname.endsWith("/assignments/resolve-layered")) {
      if (!resolveLayeredHandler) return jsonResponse({ layers: [], consideredAssignments: 0 });
      return jsonResponse(resolveLayeredHandler(url));
    }

    if (url.pathname.endsWith("/policy-types")) {
      if (!policyTypesHandler) return jsonResponse({ policyTypes: [] });
      return jsonResponse(policyTypesHandler());
    }

    if (url.pathname.endsWith("/health")) {
      return jsonResponse({ status: "ok" });
    }

    return jsonResponse({ error: "NotFoundError", message: `No mock handler for ${url.pathname}` }, 404);
  }) as typeof fetch;
}
