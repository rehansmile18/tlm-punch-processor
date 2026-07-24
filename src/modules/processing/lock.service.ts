import os from "node:os";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { ProcessingLock, ProcessingLockDoc } from "../../models/processingLock.model";
import { ProcessingRun } from "../../models/processingRun.model";
import { env } from "../../config/env";
import { LockConflictError, LockLostError } from "../../utils/errors";

function isDuplicateKeyError(err: unknown): boolean {
  return err instanceof Error && err.name === "MongoServerError" && (err as unknown as { code?: number }).code === 11000;
}

export interface AcquiredLock {
  lockId: Types.ObjectId;
  workerId: string;
}

/**
 * Acquires the processing lock for one (employeeId, payPeriodId). Relies purely on the unique
 * partial index (`{employeeId, payPeriodId}` filtered to status:"held") for atomicity — a
 * plain `create()` either succeeds or throws E11000 if someone else already holds it, with no
 * separate "check then insert" race window.
 */
export async function acquireLock(employeeId: string, payPeriodId: string, runId: Types.ObjectId): Promise<AcquiredLock> {
  const workerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;
  const now = new Date();
  try {
    const doc = await ProcessingLock.create({
      employeeId,
      payPeriodId,
      status: "held",
      workerId,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + env.lockLeaseMs),
      runId,
    });
    return { lockId: doc._id, workerId };
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new LockConflictError(employeeId, payPeriodId);
    throw err;
  }
}

/**
 * Renews the lease on a held lock. Call periodically (env.lockLeaseMs / 3 is a reasonable cadence)
 * from inside long-running processing so the reaper doesn't steal a lock out from under a worker
 * that's still alive and making progress. Throws LockLostError if the reaper already took it —
 * the caller must abort processing immediately rather than keep computing on a lock it no longer holds.
 */
export async function heartbeat(lockId: Types.ObjectId, workerId: string, employeeId: string, payPeriodId: string): Promise<void> {
  const now = new Date();
  const result = await ProcessingLock.updateOne(
    { _id: lockId, workerId, status: "held" },
    { $set: { heartbeatAt: now, expiresAt: new Date(now.getTime() + env.lockLeaseMs) } }
  );
  if (result.matchedCount === 0) throw new LockLostError(employeeId, payPeriodId);
}

/** Always call in a `finally` around per-employee processing — both success and failure release the lock. */
export async function releaseLock(lockId: Types.ObjectId, workerId: string): Promise<void> {
  await ProcessingLock.updateOne({ _id: lockId, workerId }, { $set: { status: "released" } });
}

/**
 * Sweeps locks whose lease expired without a heartbeat (the holder crashed or hung) — releases
 * them and marks their ProcessingRun failed so it's visible and safely retryable. Does NOT touch
 * any lock still within its lease, however long ago it was acquired.
 */
export async function reapStaleLocks(): Promise<number> {
  const now = new Date();
  const stale = await ProcessingLock.find({ status: "held", expiresAt: { $lt: now } }).lean();
  for (const lock of stale) {
    await ProcessingLock.updateOne({ _id: lock._id, status: "held" }, { $set: { status: "released" } });
    await ProcessingRun.updateOne(
      { _id: lock.runId, runStatus: { $in: ["queued", "processing"] } },
      { $set: { runStatus: "failed", errorMessage: "Processing lock expired without heartbeat — worker likely crashed", completedAt: now } }
    ).catch((err) => console.error("reapStaleLocks: failed to mark run failed", err));
  }
  return stale.length;
}

export type { ProcessingLockDoc };
