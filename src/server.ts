import { createApp } from "./app";
import { connectDb, disconnectDb } from "./config/db";
import { env } from "./config/env";
import { reapStaleLocksJob } from "./jobs/reapStaleLocks";

const REAPER_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  await connectDb();
  const app = createApp();

  const server = app.listen(env.port, () => {
    console.log(`TLM Punch Processor API listening on port ${env.port}`);
  });

  const runReaper = () => reapStaleLocksJob().catch((err) => console.error("reapStaleLocksJob failed", err));

  // Run once on boot so a crash-and-restart doesn't leave orphaned locks stuck until the first
  // interval tick, then on a short interval — leases are short (minutes, not days), unlike TLM's
  // once-a-day effective-date housekeeping.
  void runReaper();
  const interval = setInterval(runReaper, REAPER_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    clearInterval(interval);
    const forceExit = setTimeout(() => {
      console.error("Shutdown timed out; forcing exit");
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    server.close(async () => {
      await disconnectDb().catch(() => undefined);
      clearTimeout(forceExit);
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
