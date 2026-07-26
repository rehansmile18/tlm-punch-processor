import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import { listTimesheetsQuerySchema, timesheetIdParamSchema, voidTimesheetSchema } from "./timesheet.validators";
import {
  listTimesheetsHandler,
  getTimesheetHandler,
  getTimesheetAuditTrailHandler,
  voidTimesheetHandler,
} from "./timesheet.controller";

// TODO(phase: processing orchestrator): POST /timesheets/:id/reprocess depends on the processing
// orchestrator's per-employee locking (POST /processing/runs already covers reprocessing a whole
// period; a dedicated single-timesheet endpoint isn't added here yet).
export const timesheetRouter = Router();
timesheetRouter.use(authenticate);

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
