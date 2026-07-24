import { Router } from "express";

// TODO(phase: concurrency + processing API): POST /processing/runs (batch, p-limit + lock),
// GET /processing/runs/:runId, POST /processing/runs/:runId/cancel. Placeholder so app.ts
// resolves while earlier phases land first.
export const processingRouter = Router();
