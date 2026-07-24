import { NextFunction, Request, Response as ExpressResponse } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { HttpError } from "../utils/errors";
import { UserRole } from "../types/domain";
import { asyncHandler } from "./errorHandler";

interface AuthTokenPayload {
  userId: string;
}

function isAuthTokenPayload(payload: unknown): payload is AuthTokenPayload {
  if (typeof payload !== "object" || payload === null) return false;
  return typeof (payload as Record<string, unknown>).userId === "string";
}

interface LiveProfile {
  role: UserRole;
  clientId: string | null;
  status: string;
}

interface CacheEntry extends LiveProfile {
  cachedAt: number;
}

// Keyed by the raw bearer token, short-lived per env.userProfileCacheMs. This service has no User
// collection of its own — role/clientId/status always comes from TLM's GET /users/me (the same
// endpoint TLM's own profile page uses), so a role change made in TLM propagates here within this
// bound instead of requiring a fresh login. Never persisted, process-memory only.
const profileCache = new Map<string, CacheEntry>();

async function fetchLiveProfile(token: string): Promise<LiveProfile> {
  let res: globalThis.Response;
  try {
    res = await fetch(`${env.ruleRepoBaseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new HttpError(401, "Could not reach the Rule Repository to verify this token");
  }
  if (!res.ok) {
    throw new HttpError(401, "Invalid or expired token");
  }
  const body = (await res.json()) as { role: UserRole; clientId: string | null; status: string };
  return { role: body.role, clientId: body.clientId, status: body.status };
}

async function resolveProfile(token: string): Promise<LiveProfile> {
  const cached = profileCache.get(token);
  if (cached && Date.now() - cached.cachedAt < env.userProfileCacheMs) {
    return cached;
  }
  const fresh = await fetchLiveProfile(token);
  profileCache.set(token, { ...fresh, cachedAt: Date.now() });
  return fresh;
}

/**
 * Verifies the JWT signature/expiry locally (same secret, same tokens TLM issues on login) — this
 * proves *who* cheaply, with no network call. Live role/clientId/status then comes from TLM's
 * GET /users/me, cached briefly (see resolveProfile above) rather than fetched on every request.
 */
export const authenticate = asyncHandler(async (req: Request, _res: ExpressResponse, next: NextFunction) => {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length);
  let payload: unknown;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  if (!isAuthTokenPayload(payload)) {
    throw new HttpError(401, "Malformed token payload");
  }

  const profile = await resolveProfile(token);
  if (profile.status !== "active") {
    throw new HttpError(401, "Invalid or inactive user");
  }

  req.auth = { userId: payload.userId, role: profile.role, clientId: profile.clientId };
  next();
});

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: ExpressResponse, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      throw new HttpError(403, `Requires one of roles: ${roles.join(", ")}`);
    }
    next();
  };
}
