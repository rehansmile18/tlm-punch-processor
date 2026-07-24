import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { getReadClientFilter, assertCanWriteClient } from "../../middleware/tenantScope";
import * as employeeGroupService from "./employeeGroup.service";
import { CreateEmployeeGroupInput, UpdateEmployeeGroupInput } from "./employeeGroup.validators";

export const listEmployeeGroupsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const result = await employeeGroupService.listEmployeeGroups(getReadClientFilter(req), page, pageSize);
  res.json(result);
});

export const getEmployeeGroupHandler = asyncHandler(async (req: Request, res: Response) => {
  const doc = await employeeGroupService.getEmployeeGroup(req.params.id, getReadClientFilter(req));
  res.json(doc);
});

export const createEmployeeGroupHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateEmployeeGroupInput;
  assertCanWriteClient(req, input.clientId);
  const doc = await employeeGroupService.createEmployeeGroup(input);
  res.status(201).json(doc);
});

export const updateEmployeeGroupHandler = asyncHandler(async (req: Request, res: Response) => {
  const existing = await employeeGroupService.getEmployeeGroup(req.params.id, getReadClientFilter(req));
  assertCanWriteClient(req, String(existing.clientId));
  const doc = await employeeGroupService.updateEmployeeGroup(req.params.id, req.body as UpdateEmployeeGroupInput, getReadClientFilter(req));
  res.json(doc);
});
