import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { getReadClientFilter, assertCanWriteClient } from "../../middleware/tenantScope";
import * as payPeriodConfigService from "./payPeriodConfig.service";
import { CreatePayPeriodConfigInput, UpdatePayPeriodConfigInput } from "./payPeriodConfig.validators";

export const listPayPeriodConfigsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const result = await payPeriodConfigService.listPayPeriodConfigs(getReadClientFilter(req), page, pageSize);
  res.json(result);
});

export const getPayPeriodConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const doc = await payPeriodConfigService.getPayPeriodConfig(req.params.id, getReadClientFilter(req));
  res.json(doc);
});

export const createPayPeriodConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreatePayPeriodConfigInput;
  assertCanWriteClient(req, input.clientId);
  const doc = await payPeriodConfigService.createPayPeriodConfig(input);
  res.status(201).json(doc);
});

export const updatePayPeriodConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const existing = await payPeriodConfigService.getPayPeriodConfig(req.params.id, getReadClientFilter(req));
  assertCanWriteClient(req, String(existing.clientId));
  const doc = await payPeriodConfigService.updatePayPeriodConfig(req.params.id, req.body as UpdatePayPeriodConfigInput, getReadClientFilter(req));
  res.json(doc);
});
