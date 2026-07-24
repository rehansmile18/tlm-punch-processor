import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, TestContext } from "./helpers";
import { acquireLock, heartbeat, releaseLock, reapStaleLocks } from "../src/modules/processing/lock.service";
import { ProcessingLock } from "../src/models/processingLock.model";
import { ProcessingRun } from "../src/models/processingRun.model";
import { env } from "../src/config/env";
import { LockConflictError, LockLostError } from "../src/utils/errors";

/** Minimal valid ProcessingRun so reapStaleLocks' side effect has a real doc to update. */
function makeRunDoc(runId: Types.ObjectId, overrides: Partial<{ runStatus: string }> = {}) {
  return {
    _id: runId,
    runId: runId.toString(),
    clientId: new Types.ObjectId(),
    employeeId: `emp-${runId.toString()}`,
    businessDate: "2026-07-21",
    timezone: "UTC",
    engineVersion: "test",
    runStatus: overrides.runStatus ?? "processing",
  };
}

describe("lock service", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestContext();
    // Mongoose builds indexes in the background after connecting; the unique partial index this
    // whole suite exercises must be live before any test runs, or "concurrent" acquires would
    // spuriously both succeed.
    await ProcessingLock.init();
  });
  afterAll(() => ctx.teardown());

  it("acquires a lock for a fresh employee+payPeriod", async () => {
    const runId = new Types.ObjectId();
    const result = await acquireLock("emp-basic", "2026-P1", runId);
    expect(result.lockId).toBeInstanceOf(Types.ObjectId);
    expect(typeof result.workerId).toBe("string");
    expect(result.workerId.length).toBeGreaterThan(0);
  });

  it("throws LockConflictError on a sequential double-acquire for the same employee+payPeriod", async () => {
    const runId = new Types.ObjectId();
    await acquireLock("emp-seq", "2026-P2", runId);
    await expect(acquireLock("emp-seq", "2026-P2", new Types.ObjectId())).rejects.toThrow(LockConflictError);
  });

  it("under real concurrency, exactly one of two racing acquireLock calls for the same employee+payPeriod succeeds", async () => {
    const employeeId = "emp-race";
    const payPeriodId = "2026-P3";
    const results = await Promise.allSettled([
      acquireLock(employeeId, payPeriodId, new Types.ObjectId()),
      acquireLock(employeeId, payPeriodId, new Types.ObjectId()),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(LockConflictError);

    // The DB itself must agree: only one held lock row for this employee+payPeriod.
    const heldCount = await ProcessingLock.countDocuments({ employeeId, payPeriodId, status: "held" });
    expect(heldCount).toBe(1);
  });

  it("allows concurrent locks for different employees, or the same employee with a different payPeriodId", async () => {
    const [a, b] = await Promise.all([
      acquireLock("emp-diff-1", "2026-P4", new Types.ObjectId()),
      acquireLock("emp-diff-2", "2026-P4", new Types.ObjectId()),
    ]);
    expect(a.lockId).toBeInstanceOf(Types.ObjectId);
    expect(b.lockId).toBeInstanceOf(Types.ObjectId);

    const [c, d] = await Promise.all([
      acquireLock("emp-same", "2026-P5", new Types.ObjectId()),
      acquireLock("emp-same", "2026-P6", new Types.ObjectId()),
    ]);
    expect(c.lockId).toBeInstanceOf(Types.ObjectId);
    expect(d.lockId).toBeInstanceOf(Types.ObjectId);
  });

  it("allows a new acquireLock after the prior lock was released", async () => {
    const employeeId = "emp-release-reacquire";
    const payPeriodId = "2026-P7";
    const first = await acquireLock(employeeId, payPeriodId, new Types.ObjectId());
    await releaseLock(first.lockId, first.workerId);

    const second = await acquireLock(employeeId, payPeriodId, new Types.ObjectId());
    expect(second.lockId).toBeInstanceOf(Types.ObjectId);
    expect(second.lockId.equals(first.lockId)).toBe(false);

    const heldCount = await ProcessingLock.countDocuments({ employeeId, payPeriodId, status: "held" });
    expect(heldCount).toBe(1);
  });

  it("heartbeat renews successfully for the lock's own workerId", async () => {
    const { lockId, workerId } = await acquireLock("emp-heartbeat-ok", "2026-P8", new Types.ObjectId());
    const before = await ProcessingLock.findById(lockId).lean();
    await new Promise((resolve) => setTimeout(resolve, 10));

    await heartbeat(lockId, workerId, "emp-heartbeat-ok", "2026-P8");

    const after = await ProcessingLock.findById(lockId).lean();
    expect(after).not.toBeNull();
    expect(after!.expiresAt.getTime()).toBeGreaterThan(before!.expiresAt.getTime());
    expect(after!.status).toBe("held");
  });

  it("heartbeat throws LockLostError when called with a different workerId than the actual holder", async () => {
    const { lockId } = await acquireLock("emp-heartbeat-wrong-worker", "2026-P9", new Types.ObjectId());
    await expect(heartbeat(lockId, "not-the-real-worker", "emp-heartbeat-wrong-worker", "2026-P9")).rejects.toThrow(
      LockLostError
    );
  });

  it("heartbeat throws LockLostError after the lock has already been released", async () => {
    const { lockId, workerId } = await acquireLock("emp-heartbeat-released", "2026-P10", new Types.ObjectId());
    await releaseLock(lockId, workerId);
    await expect(heartbeat(lockId, workerId, "emp-heartbeat-released", "2026-P10")).rejects.toThrow(LockLostError);
  });

  it("reapStaleLocks releases an expired held lock and marks its ProcessingRun failed", async () => {
    const runId = new Types.ObjectId();
    await ProcessingRun.create(makeRunDoc(runId, { runStatus: "processing" }));

    const staleLock = await ProcessingLock.create({
      employeeId: "emp-stale",
      payPeriodId: "2026-P11",
      status: "held",
      workerId: "dead-worker:1234:abcd",
      acquiredAt: new Date(Date.now() - 120_000),
      heartbeatAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 1000),
      runId,
    });

    const count = await reapStaleLocks();
    expect(count).toBeGreaterThanOrEqual(1);

    const reapedLock = await ProcessingLock.findById(staleLock._id).lean();
    expect(reapedLock!.status).toBe("released");

    const reapedRun = await ProcessingRun.findById(runId).lean();
    expect(reapedRun!.runStatus).toBe("failed");
    expect(reapedRun!.errorMessage).toBeTruthy();
  });

  it("reapStaleLocks does not touch a held lock whose expiresAt is still in the future", async () => {
    const runId = new Types.ObjectId();
    await ProcessingRun.create(makeRunDoc(runId, { runStatus: "processing" }));

    const freshLock = await ProcessingLock.create({
      employeeId: "emp-not-stale",
      payPeriodId: "2026-P12",
      status: "held",
      workerId: "alive-worker:5678:efgh",
      acquiredAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      runId,
    });

    await reapStaleLocks();

    const stillHeld = await ProcessingLock.findById(freshLock._id).lean();
    expect(stillHeld!.status).toBe("held");
  });

  it("sets a held lock's expiresAt to acquiredAt + env.lockLeaseMs", async () => {
    const { lockId } = await acquireLock("emp-lease", "2026-P13", new Types.ObjectId());
    const lock = await ProcessingLock.findById(lockId).lean();
    expect(lock).not.toBeNull();

    const expectedExpiry = lock!.acquiredAt.getTime() + env.lockLeaseMs;
    expect(Math.abs(lock!.expiresAt.getTime() - expectedExpiry)).toBeLessThan(5000);
  });
});
