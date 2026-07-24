import { Router } from "express";
import { authenticatePunchIngestOrUser } from "../../middleware/punchIngestAuth";
import { validateRequest } from "../../middleware/validateRequest";
import {
  createPunchSchema,
  bulkCreatePunchSchema,
  correctPunchSchema,
  listPunchesQuerySchema,
  punchIdParamSchema,
} from "./punch.validators";
import {
  createPunchHandler,
  bulkCreatePunchesHandler,
  listPunchesHandler,
  getPunchHandler,
  correctPunchHandler,
} from "./punch.controller";

export const punchRouter = Router();
// Every punch route accepts EITHER a punch-ingest key (kiosk/upstream systems) OR a normal
// human TLM-issued JWT — see middleware/punchIngestAuth.ts for the fallback logic.
punchRouter.use(authenticatePunchIngestOrUser);

// Registered before "/:id" so "bulk" isn't captured as an id param.
punchRouter.post("/punches/bulk", validateRequest({ body: bulkCreatePunchSchema }), bulkCreatePunchesHandler);

punchRouter.get("/punches", validateRequest({ query: listPunchesQuerySchema }), listPunchesHandler);
punchRouter.get("/punches/:id", validateRequest({ params: punchIdParamSchema }), getPunchHandler);
punchRouter.post("/punches", validateRequest({ body: createPunchSchema }), createPunchHandler);
punchRouter.patch("/punches/:id", validateRequest({ params: punchIdParamSchema, body: correctPunchSchema }), correctPunchHandler);
