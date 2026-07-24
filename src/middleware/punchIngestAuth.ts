import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../utils/errors";
import { authenticate } from "./auth";

/**
 * Alternative auth path for kiosk/upstream time-clock systems submitting punches — deliberately
 * NOT a TLM user/JWT (TLM has no PUNCH_INGEST role; this key is entirely local to this service).
 * If the request carries the ingest key header, it's authenticated as a synthetic PUNCH_INGEST
 * principal with no clientId (every /punches write must specify its own clientId in the body,
 * validated per-request, since this key isn't scoped to one client in v1). Otherwise falls through
 * to the normal TLM-JWT `authenticate` — so a human CLIENT_ADMIN/PLATFORM_ADMIN can also submit
 * punches directly without needing a separate credential.
 */
export function authenticatePunchIngestOrUser(req: Request, res: Response, next: NextFunction): void {
  const ingestKey = req.header("x-punch-ingest-key");
  if (ingestKey !== undefined) {
    if (ingestKey !== env.punchIngestApiKey) {
      throw new HttpError(401, "Invalid punch-ingest key");
    }
    req.auth = { userId: "punch-ingest-service", role: "PUNCH_INGEST", clientId: null };
    next();
    return;
  }
  authenticate(req, res, next);
}
