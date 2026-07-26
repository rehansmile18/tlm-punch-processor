import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { ruleRepoConnection } from "./config/db";
import { ruleRepositoryClient } from "./clients/ruleRepositoryClient";
import { employeeRouter } from "./modules/employee/employee.routes";
import { employeeGroupRouter } from "./modules/employeeGroup/employeeGroup.routes";
import { siteRouter } from "./modules/site/site.routes";
import { taskRouter } from "./modules/task/task.routes";
import { payPeriodConfigRouter } from "./modules/payPeriodConfig/payPeriodConfig.routes";
import { punchRouter } from "./modules/punch/punch.routes";
import { processingRouter } from "./modules/processing/processing.routes";
import { timesheetRouter } from "./modules/timesheet/timesheet.routes";

export function createApp(): Express {
  const app = express();
  app.use(helmet());
  const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors(corsOrigins && corsOrigins.length > 0 ? { origin: corsOrigins } : undefined));
  // Bulk punch submissions are the largest body this service accepts — default 100kb is comfortably
  // enough for a batch of a few hundred punches, but bumped modestly for headroom.
  app.use(express.json({ limit: "1mb" }));
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  // Deep health check: this service's own DB status, the SEPARATE connection to TLM's own
  // database (Employee/Site/Task/EmployeeGroup/PayPeriodConfig/PayrollCalendar/Punch), PLUS a
  // short-timeout, non-blocking reachability probe of the Rule Repository's HTTP API — reported
  // separately so e.g. "my own DB is fine but TLM's database is unreachable" (master-data/punch
  // endpoints would fail) is distinguishable from "I'm broken" or "TLM's API is just down."
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

  const v1 = express.Router();
  v1.use(globalRateLimiter);
  // punchRouter MUST be mounted first: every router's `.use(authenticate)` runs unconditionally
  // for ANY request reaching that router, regardless of whether one of its own routes ends up
  // matching — Express doesn't scope an unprefixed `.use()` to "only requests this router will
  // actually handle." A punch-ingest-key request (no Bearer header) would be rejected by the
  // FIRST router's strict auth check before ever reaching punchRouter's own, more permissive
  // authenticatePunchIngestOrUser if any stricter-auth router ran first.
  v1.use(punchRouter);
  v1.use(employeeRouter);
  v1.use(employeeGroupRouter);
  v1.use(siteRouter);
  v1.use(taskRouter);
  v1.use(payPeriodConfigRouter);
  v1.use(processingRouter);
  v1.use(timesheetRouter);
  app.use("/api/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
