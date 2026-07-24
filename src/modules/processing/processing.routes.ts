import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import { createProcessingRunSchema } from "./processing.validators";
import { createProcessingRunHandler } from "./processing.controller";

export const processingRouter = Router();
processingRouter.use(authenticate);

processingRouter.post("/processing/runs", validateRequest({ body: createProcessingRunSchema }), createProcessingRunHandler);
