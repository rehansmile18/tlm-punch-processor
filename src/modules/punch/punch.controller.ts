import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { getReadClientFilter, assertCanWriteClient } from "../../middleware/tenantScope";
import { ForbiddenError } from "../../utils/errors";
import * as punchService from "./punch.service";
import { CreatePunchInput, BulkCreatePunchInput, CorrectPunchInput } from "./punch.validators";

/**
 * A PUNCH_INGEST credential (kiosk/upstream time-clock system, see punchIngestAuth.ts) isn't a
 * PLATFORM_ADMIN or CLIENT_ADMIN, so the normal assertCanWriteClient would always reject it —
 * that middleware is shared by every other module, so the PUNCH_INGEST bypass lives HERE,
 * explicitly, local to punch writes only, rather than loosening the shared tenant-scoping utility.
 */
function assertCanWritePunch(req: Request, targetClientId: string): void {
  if (req.auth?.role === "PUNCH_INGEST") return;
  assertCanWriteClient(req, targetClientId);
}

export const createPunchHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreatePunchInput;
  assertCanWritePunch(req, input.clientId);
  const doc = await punchService.createPunch(input);
  res.status(201).json(doc);
});

export const bulkCreatePunchesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { punches } = req.body as BulkCreatePunchInput;
  for (const punch of punches) {
    assertCanWritePunch(req, punch.clientId);
  }
  const result = await punchService.bulkCreatePunches(punches);
  res.status(207).json(result);
});

export const listPunchesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, siteId, from, to, page, pageSize } = req.query as unknown as {
    employeeId?: string;
    siteId?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  };
  if (!req.auth || req.auth.role === "PUNCH_INGEST") throw new ForbiddenError("Insufficient role to list punches");
  const result = await punchService.listPunches(getReadClientFilter(req), { employeeId, siteId, from, to }, page, pageSize);
  res.json(result);
});

export const getPunchHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth || req.auth.role === "PUNCH_INGEST") throw new ForbiddenError("Insufficient role to view punches");
  const doc = await punchService.getPunch(req.params.id, getReadClientFilter(req));
  res.json(doc);
});

export const correctPunchHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth || req.auth.role === "PUNCH_INGEST") throw new ForbiddenError("Insufficient role to correct punches");
  const existing = await punchService.getPunch(req.params.id, getReadClientFilter(req));
  assertCanWriteClient(req, String(existing.clientId));
  const doc = await punchService.correctPunch(req.params.id, req.body as CorrectPunchInput, getReadClientFilter(req));
  res.status(201).json(doc);
});
