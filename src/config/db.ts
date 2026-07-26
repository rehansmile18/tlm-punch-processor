import mongoose, { Connection } from "mongoose";
import { env } from "./env";

/**
 * This service maintains TWO separate Mongoose connections:
 * - The DEFAULT connection (`mongoose.connect` / `mongoose.model`) is this service's OWN
 *   database (tlm_punch_processor) — processing-only state: ProcessingLock, ProcessingRun,
 *   ProcessingAuditEntry, Timesheet.
 * - `ruleRepoConnection` (exported below) points at the TLM Rule Repository's own MongoDB
 *   database. Employee, EmployeeGroup, Site, Task, PayPeriodConfig, PayrollCalendar, and Punch
 *   all bind to THIS connection instead (see each of those model files) rather than the default
 *   one, since they're client-owned master data that lives alongside TLM's own Client/User/Policy
 *   collections, not processing state.
 *
 * Created UNOPENED at module load (no URI given yet) so model files can call
 * `ruleRepoConnection.model(...)` at their own import time without an async bootstrap step —
 * schema registration works on a connection before it's actually opened. The real URI is decided
 * later, at connectDb() time, via `.openUri(...)` — this indirection is what lets tests point this
 * connection at a second in-memory Mongo instance instead of being locked into whatever
 * `env.ruleRepoMongoUri` resolved to when this module first happened to load (see tests/helpers.ts).
 */
export const ruleRepoConnection: Connection = mongoose.createConnection();

export async function connectDb(): Promise<void> {
  mongoose.set("strictQuery", true);

  mongoose.connection.on("error", (err) => console.error("Processing DB connection error:", err.message));
  mongoose.connection.on("disconnected", () => console.warn("Processing DB disconnected"));
  mongoose.connection.on("reconnected", () => console.log("Processing DB reconnected"));

  ruleRepoConnection.on("error", (err) => console.error("Rule Repository DB connection error:", err.message));
  ruleRepoConnection.on("disconnected", () => console.warn("Rule Repository DB disconnected"));
  ruleRepoConnection.on("reconnected", () => console.log("Rule Repository DB reconnected"));

  await Promise.all([
    mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 }),
    ruleRepoConnection.openUri(env.ruleRepoMongoUri, { serverSelectionTimeoutMS: 10_000 }),
  ]);
}

export async function disconnectDb(): Promise<void> {
  await Promise.all([mongoose.disconnect(), ruleRepoConnection.close()]);
}
