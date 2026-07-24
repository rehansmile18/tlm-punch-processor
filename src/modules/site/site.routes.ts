import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import { createSiteSchema, updateSiteSchema, listSitesQuerySchema, siteIdParamSchema } from "./site.validators";
import { listSitesHandler, getSiteHandler, createSiteHandler, updateSiteHandler } from "./site.controller";

export const siteRouter = Router();
siteRouter.use(authenticate);

siteRouter.get("/sites", validateRequest({ query: listSitesQuerySchema }), listSitesHandler);
siteRouter.get("/sites/:id", validateRequest({ params: siteIdParamSchema }), getSiteHandler);
siteRouter.post("/sites", validateRequest({ body: createSiteSchema }), createSiteHandler);
siteRouter.patch("/sites/:id", validateRequest({ params: siteIdParamSchema, body: updateSiteSchema }), updateSiteHandler);
