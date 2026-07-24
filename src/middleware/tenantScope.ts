import { Request } from "express";
import { Types } from "mongoose";
import { ForbiddenError, BadRequestError } from "../utils/errors";

/**
 * Returns the Mongo filter clause enforcing tenant isolation for read queries.
 * PLATFORM_ADMIN may optionally narrow by an explicit clientId query param;
 * every other role is hard-scoped to their own token clientId.
 */
export function getReadClientFilter(req: Request): Record<string, unknown> {
  if (!req.auth) throw new ForbiddenError("Not authenticated");
  if (req.auth.role === "PLATFORM_ADMIN") {
    const requested = req.query.clientId;
    return typeof requested === "string" ? { clientId: new Types.ObjectId(requested) } : {};
  }
  if (!req.auth.clientId) throw new ForbiddenError("Token missing clientId for non-admin role");
  return { clientId: new Types.ObjectId(req.auth.clientId) };
}

/** Throws unless the caller may write documents owned by targetClientId. */
export function assertCanWriteClient(req: Request, targetClientId: string): void {
  if (!req.auth) throw new ForbiddenError("Not authenticated");
  if (req.auth.role === "PLATFORM_ADMIN") return;
  if (req.auth.role !== "CLIENT_ADMIN") throw new ForbiddenError("Insufficient role to modify this resource");
  if (req.auth.clientId !== targetClientId) {
    throw new ForbiddenError("Cannot modify another client's resources");
  }
}

export function requireClientId(clientId: unknown): string {
  if (typeof clientId !== "string" || !Types.ObjectId.isValid(clientId)) {
    throw new BadRequestError("A valid clientId is required");
  }
  return clientId;
}
