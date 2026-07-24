import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { getReadClientFilter, assertCanWriteClient } from "../../middleware/tenantScope";
import * as employeeService from "./employee.service";
import { CreateEmployeeInput, UpdateEmployeeInput } from "./employee.validators";

export const listEmployeesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { employeeGroupId, page, pageSize } = req.query as unknown as {
    employeeGroupId?: string;
    page: number;
    pageSize: number;
  };
  const result = await employeeService.listEmployees(getReadClientFilter(req), employeeGroupId, page, pageSize);
  res.json(result);
});

export const getEmployeeHandler = asyncHandler(async (req: Request, res: Response) => {
  const doc = await employeeService.getEmployee(req.params.id, getReadClientFilter(req));
  res.json(doc);
});

export const createEmployeeHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateEmployeeInput;
  assertCanWriteClient(req, input.clientId);
  const doc = await employeeService.createEmployee(input);
  res.status(201).json(doc);
});

export const updateEmployeeHandler = asyncHandler(async (req: Request, res: Response) => {
  // Load the existing doc under the caller's own read filter first, then authorize against ITS
  // clientId, then apply the update — mirrors TLM's updateAssignmentHandler exactly.
  const existing = await employeeService.getEmployee(req.params.id, getReadClientFilter(req));
  assertCanWriteClient(req, String(existing.clientId));
  const doc = await employeeService.updateEmployee(req.params.id, req.body as UpdateEmployeeInput, getReadClientFilter(req));
  res.json(doc);
});
