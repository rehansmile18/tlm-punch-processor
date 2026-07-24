import { reapStaleLocks as reap } from "../modules/processing/lock.service";

/** Mirrors TLM's activateScheduledPolicies housekeeping pattern: run once at boot, then on an interval. */
export async function reapStaleLocksJob(): Promise<void> {
  const count = await reap();
  if (count > 0) console.log(`reapStaleLocks: released ${count} stale lock(s)`);
}
