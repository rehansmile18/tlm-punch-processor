import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { getReadClientFilter, assertCanWriteClient } from "../../middleware/tenantScope";
import * as payrollCalendarService from "./payrollCalendar.service";
import { CreatePayrollCalendarInput, UpdatePayrollCalendarInput } from "./payrollCalendar.validators";

export const listPayrollCalendarsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const result = await payrollCalendarService.listPayrollCalendars(getReadClientFilter(req), page, pageSize);
  res.json(result);
});

export const getPayrollCalendarHandler = asyncHandler(async (req: Request, res: Response) => {
  const doc = await payrollCalendarService.getPayrollCalendar(req.params.id, getReadClientFilter(req));
  res.json(doc);
});

export const createPayrollCalendarHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreatePayrollCalendarInput;
  assertCanWriteClient(req, input.clientId);
  const doc = await payrollCalendarService.createPayrollCalendar(input);
  res.status(201).json(doc);
});

export const updatePayrollCalendarHandler = asyncHandler(async (req: Request, res: Response) => {
  const existing = await payrollCalendarService.getPayrollCalendar(req.params.id, getReadClientFilter(req));
  assertCanWriteClient(req, String(existing.clientId));
  const doc = await payrollCalendarService.updatePayrollCalendar(req.params.id, req.body as UpdatePayrollCalendarInput, getReadClientFilter(req));
  res.json(doc);
});
