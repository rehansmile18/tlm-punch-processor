import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import {
  listTimesheetsQuerySchema,
  timesheetIdParamSchema,
  voidTimesheetSchema,
  listTimesheetSiteGroupsQuerySchema,
  timesheetGridParamSchema,
  timesheetGridQuerySchema,
} from "./timesheet.validators";
import {
  listTimesheetsHandler,
  getTimesheetHandler,
  getTimesheetAuditTrailHandler,
  voidTimesheetHandler,
  listTimesheetSiteGroupsHandler,
  getTimesheetGridHandler,
} from "./timesheet.controller";

// TODO(phase: processing orchestrator): POST /timesheets/:id/reprocess depends on the processing
// orchestrator's per-employee locking (POST /processing/runs already covers reprocessing a whole
// period; a dedicated single-timesheet endpoint isn't added here yet).
export const timesheetRouter = Router();
timesheetRouter.use(authenticate);

// Registered before /timesheets/:id — otherwise Express's param route would greedily match
// "by-site" as an :id.
timesheetRouter.get(
  "/timesheets/by-site",
  validateRequest({ query: listTimesheetSiteGroupsQuerySchema }),
  listTimesheetSiteGroupsHandler
);
timesheetRouter.get(
  "/timesheets/by-site/:siteId/:payPeriodId",
  validateRequest({ params: timesheetGridParamSchema, query: timesheetGridQuerySchema }),
  getTimesheetGridHandler
);

timesheetRouter.get("/timesheets", validateRequest({ query: listTimesheetsQuerySchema }), listTimesheetsHandler);
timesheetRouter.get("/timesheets/:id", validateRequest({ params: timesheetIdParamSchema }), getTimesheetHandler);
timesheetRouter.get(
  "/timesheets/:id/audit-trail",
  validateRequest({ params: timesheetIdParamSchema }),
  getTimesheetAuditTrailHandler
);
timesheetRouter.post(
  "/timesheets/:id/void",
  validateRequest({ params: timesheetIdParamSchema, body: voidTimesheetSchema }),
  voidTimesheetHandler
);
