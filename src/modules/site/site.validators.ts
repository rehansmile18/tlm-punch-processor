import { z } from "zod";

export const createSiteSchema = z.object({
  clientId: z.string(),
  siteId: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().min(1),
});
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

// clientId is deliberately absent — a site's tenant is fixed at creation and is not reassignable
// via PATCH (mirrors TLM's assignment/policy update schemas, which also exclude clientId).
export const updateSiteSchema = z.object({
  siteId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
});
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

export const listSitesQuerySchema = z.object({
  clientId: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const siteIdParamSchema = z.object({
  id: z.string(),
});
