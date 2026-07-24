import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { getReadClientFilter, assertCanWriteClient } from "../../middleware/tenantScope";
import * as siteService from "./site.service";
import { CreateSiteInput, UpdateSiteInput } from "./site.validators";

export const listSitesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const result = await siteService.listSites(getReadClientFilter(req), page, pageSize);
  res.json(result);
});

export const getSiteHandler = asyncHandler(async (req: Request, res: Response) => {
  const doc = await siteService.getSite(req.params.id, getReadClientFilter(req));
  res.json(doc);
});

export const createSiteHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateSiteInput;
  assertCanWriteClient(req, input.clientId);
  const doc = await siteService.createSite(input);
  res.status(201).json(doc);
});

export const updateSiteHandler = asyncHandler(async (req: Request, res: Response) => {
  const existing = await siteService.getSite(req.params.id, getReadClientFilter(req));
  assertCanWriteClient(req, String(existing.clientId));
  const doc = await siteService.updateSite(req.params.id, req.body as UpdateSiteInput, getReadClientFilter(req));
  res.json(doc);
});
