import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { resolveCorsOrigins } from "./config/env";
import { ruleRepoConnection } from "./config/db";
import { ruleRepositoryClient } from "./clients/ruleRepositoryClient";
import { processingRouter } from "./modules/processing/processing.routes";
import { timesheetRouter } from "./modules/timesheet/timesheet.routes";

export function createApp(): Express {
  const app = express();
  app.use(helmet());
  // resolveCorsOrigins() refuses to boot on an unset CORS_ORIGIN outside dev/test, so this can
  // only be undefined (unrestricted, fine for local dev) locally.
  const corsOrigins = resolveCorsOrigins();
  app.use(cors(corsOrigins && corsOrigins.length > 0 ? { origin: corsOrigins } : undefined));
  // Bulk punch submissions are the largest body this service accepts — default 100kb is comfortably
  // enough for a batch of a few hundred punches, but bumped modestly for headroom.
  app.use(express.json({ limit: "1mb" }));
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  // Deep health check: this service's own DB status, the SEPARATE connection to TLM's own database
  // (Employee/EmployeeGroup/PayPeriodConfig/PayrollCalendar/Punch — this engine's own read-only
  // reference data now that tlm-backend is the public CRUD owner), PLUS a short-timeout,
  // non-blocking reachability probe of the Rule Repository's HTTP API — reported separately so e.g.
  // "my own DB is fine but TLM's database is unreachable" (processing would fail) is
  // distinguishable from "I'm broken" or "TLM's API is just down."
  app.get("/health", async (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    const ruleRepoDbUp = ruleRepoConnection.readyState === 1;
    const ruleRepoUp = await ruleRepositoryClient.healthCheck();
    const allUp = dbUp && ruleRepoDbUp;
    const status = allUp ? "ok" : "degraded";
    res.status(allUp ? 200 : 503).json({
      status,
      db: dbUp ? "up" : "down",
      ruleRepoDb: ruleRepoDbUp ? "up" : "down",
      ruleRepository: ruleRepoUp ? "up" : "down",
    });
  });

  const globalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    message: { error: "TooManyRequests", message: "Too many requests; slow down and try again later" },
  });

  // Employee/EmployeeGroup/Site/Task/PayPeriodConfig/PayrollCalendar/Punch CRUD, and punch
  // ingestion, are no longer exposed here — tlm-backend is now their sole public owner. This
  // service's remaining routes (processing trigger, timesheet view/void) are meant to be called
  // by tlm-backend as a trusted service identity, not directly by end-user JWTs — enforced
  // operationally (only tlm-backend holds a punch-processor service-account token), not by new
  // code here; `authenticate` still just verifies *a* valid TLM JWT, same as before.
  const v1 = express.Router();
  v1.use(globalRateLimiter);
  v1.use(processingRouter);
  v1.use(timesheetRouter);
  app.use("/api/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
