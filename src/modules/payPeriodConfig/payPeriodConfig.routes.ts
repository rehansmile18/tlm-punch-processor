import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import {
  createPayPeriodConfigSchema,
  updatePayPeriodConfigSchema,
  listPayPeriodConfigsQuerySchema,
  payPeriodConfigIdParamSchema,
} from "./payPeriodConfig.validators";
import {
  listPayPeriodConfigsHandler,
  getPayPeriodConfigHandler,
  createPayPeriodConfigHandler,
  updatePayPeriodConfigHandler,
} from "./payPeriodConfig.controller";
import {
  createPayrollCalendarSchema,
  updatePayrollCalendarSchema,
  listPayrollCalendarsQuerySchema,
  payrollCalendarIdParamSchema,
} from "./payrollCalendar.validators";
import {
  listPayrollCalendarsHandler,
  getPayrollCalendarHandler,
  createPayrollCalendarHandler,
  updatePayrollCalendarHandler,
} from "./payrollCalendar.controller";

// Both PayPeriodConfig and PayrollCalendar CRUD live on this one router — app.ts only imports a
// single payPeriodConfigRouter covering both collections.
export const payPeriodConfigRouter = Router();
payPeriodConfigRouter.use(authenticate);

payPeriodConfigRouter.get(
  "/pay-period-configs",
  validateRequest({ query: listPayPeriodConfigsQuerySchema }),
  listPayPeriodConfigsHandler
);
payPeriodConfigRouter.get(
  "/pay-period-configs/:id",
  validateRequest({ params: payPeriodConfigIdParamSchema }),
  getPayPeriodConfigHandler
);
payPeriodConfigRouter.post(
  "/pay-period-configs",
  validateRequest({ body: createPayPeriodConfigSchema }),
  createPayPeriodConfigHandler
);
payPeriodConfigRouter.patch(
  "/pay-period-configs/:id",
  validateRequest({ params: payPeriodConfigIdParamSchema, body: updatePayPeriodConfigSchema }),
  updatePayPeriodConfigHandler
);

payPeriodConfigRouter.get(
  "/payroll-calendars",
  validateRequest({ query: listPayrollCalendarsQuerySchema }),
  listPayrollCalendarsHandler
);
payPeriodConfigRouter.get(
  "/payroll-calendars/:id",
  validateRequest({ params: payrollCalendarIdParamSchema }),
  getPayrollCalendarHandler
);
payPeriodConfigRouter.post(
  "/payroll-calendars",
  validateRequest({ body: createPayrollCalendarSchema }),
  createPayrollCalendarHandler
);
payPeriodConfigRouter.patch(
  "/payroll-calendars/:id",
  validateRequest({ params: payrollCalendarIdParamSchema, body: updatePayrollCalendarSchema }),
  updatePayrollCalendarHandler
);
