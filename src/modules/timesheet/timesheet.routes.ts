import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import { listTimesheetsQuerySchema, timesheetIdParamSchema, voidTimesheetSchema } from "./timesheet.validators";
import { listTimesheetsHandler, getTimesheetHandler, voidTimesheetHandler } from "./timesheet.controller";

// TODO(phase: processing orchestrator): GET /timesheets/:id/audit-trail, POST /timesheets/:id/reprocess
// depend on the processing orchestrator, which doesn't exist yet — not added here.
export const timesheetRouter = Router();
timesheetRouter.use(authenticate);

timesheetRouter.get("/timesheets", validateRequest({ query: listTimesheetsQuerySchema }), listTimesheetsHandler);
timesheetRouter.get("/timesheets/:id", validateRequest({ params: timesheetIdParamSchema }), getTimesheetHandler);
timesheetRouter.post(
  "/timesheets/:id/void",
  validateRequest({ params: timesheetIdParamSchema, body: voidTimesheetSchema }),
  voidTimesheetHandler
);
