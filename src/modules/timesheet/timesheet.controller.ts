import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { getReadClientFilter, assertCanWriteClient } from "../../middleware/tenantScope";
import * as timesheetService from "./timesheet.service";
import { VoidTimesheetInput } from "./timesheet.validators";
import { TimesheetStatus } from "../../types/domain";

export const listTimesheetsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, payPeriodId, status, includeSuperseded, page, pageSize } = req.query as unknown as {
    employeeId?: string;
    payPeriodId?: string;
    status?: TimesheetStatus;
    includeSuperseded?: boolean;
    page: number;
    pageSize: number;
  };
  const result = await timesheetService.listTimesheets(
    getReadClientFilter(req),
    { employeeId, payPeriodId, status, includeSuperseded },
    page,
    pageSize
  );
  res.json(result);
});

export const getTimesheetHandler = asyncHandler(async (req: Request, res: Response) => {
  const doc = await timesheetService.getTimesheet(req.params.id, getReadClientFilter(req));
  res.json(doc);
});

export const getTimesheetAuditTrailHandler = asyncHandler(async (req: Request, res: Response) => {
  const entries = await timesheetService.getTimesheetAuditTrail(req.params.id, getReadClientFilter(req));
  res.json({ entries });
});

export const voidTimesheetHandler = asyncHandler(async (req: Request, res: Response) => {
  // Load the existing doc under the caller's own read filter first, then authorize against ITS
  // clientId — mirrors employee.controller.ts's updateEmployeeHandler exactly.
  const existing = await timesheetService.getTimesheet(req.params.id, getReadClientFilter(req));
  assertCanWriteClient(req, String(existing.clientId));
  const { reason } = req.body as VoidTimesheetInput;
  const doc = await timesheetService.voidTimesheet(req.params.id, reason, getReadClientFilter(req), req.auth?.userId);
  res.json(doc);
});

export const listTimesheetSiteGroupsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { siteId, siteIds, payPeriodId, includeSuperseded, page, pageSize } = req.query as unknown as {
    siteId?: string;
    siteIds?: string;
    payPeriodId?: string;
    includeSuperseded?: boolean;
    page: number;
    pageSize: number;
  };
  const result = await timesheetService.listTimesheetSiteGroups(
    getReadClientFilter(req),
    { siteId, siteIds: siteIds ? siteIds.split(",").filter(Boolean) : undefined, payPeriodId, includeSuperseded },
    page,
    pageSize
  );
  res.json(result);
});

export const getTimesheetGridHandler = asyncHandler(async (req: Request, res: Response) => {
  const { siteId, payPeriodId } = req.params as { siteId: string; payPeriodId: string };
  const { includeSuperseded } = req.query as unknown as { includeSuperseded?: boolean };
  const grid = await timesheetService.getTimesheetGridForSite(siteId, payPeriodId, getReadClientFilter(req), includeSuperseded);
  res.json(grid);
});
