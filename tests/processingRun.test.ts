import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, TestContext } from "./helpers";
import {
  createProcessingRun,
  completeProcessingRun,
  failProcessingRun,
  getProcessingRun,
} from "../src/modules/processing/processingRun.service";
import { ProcessingRun } from "../src/models/processingRun.model";
import { createInitialState } from "../src/engine/types";
import { NotFoundError } from "../src/utils/errors";

describe("processingRun service", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestContext();
  });
  afterAll(() => ctx.teardown());

  it("creates a processing run in the processing lifecycle state", async () => {
    const clientId = new Types.ObjectId().toString();
    const punchId = new Types.ObjectId().toString();

    const run = await createProcessingRun({
      clientId,
      employeeId: "emp-create-1",
      businessDate: "2026-07-21",
      timezone: "America/Los_Angeles",
      punchIds: [punchId],
      engineVersion: "test-engine-1",
    });

    expect(typeof run.runId).toBe("string");
    expect(run.runId.length).toBeGreaterThan(0);
    expect(run.runStatus).toBe("processing");
    expect(run.status).toBe("ok");
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.completedAt).toBeNull();
    expect(run.finalState).toBeNull();
    expect(String(run.clientId)).toBe(clientId);
    expect(run.punchIds.map((id) => String(id))).toEqual([punchId]);
  });

  it("completeProcessingRun sets status 'ok' when there are no unresolved levels/refs", async () => {
    const clientId = new Types.ObjectId().toString();
    const run = await createProcessingRun({
      clientId,
      employeeId: "emp-complete-ok",
      businessDate: "2026-07-21",
      timezone: "UTC",
      punchIds: [],
      engineVersion: "test-engine-1",
    });

    const finalState = createInitialState("2026-07-21", "UTC", []);
    const resolvedLayers = [
      { assignmentId: "a1", targetType: "EMPLOYEE" as const, priority: 1, ruleGroupId: "rg1", ruleGroupVersion: 1 },
    ];

    const completed = await completeProcessingRun(run.runId, {
      resolvedLayers,
      unresolvedLevels: [],
      unresolvedRefs: [],
      finalState,
      flags: ["some-flag"],
    });

    expect(completed.runStatus).toBe("completed");
    expect(completed.status).toBe("ok");
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(completed.finalState).toEqual(finalState);
    expect(completed.resolvedLayers).toEqual(resolvedLayers);
    expect(completed.unresolvedLevels).toEqual([]);
    expect(completed.unresolvedRefs).toEqual([]);
    expect(completed.flags).toEqual(["some-flag"]);
  });

  it("completeProcessingRun sets status 'needs_review' when there are unresolved levels or refs", async () => {
    const clientId = new Types.ObjectId().toString();
    const run = await createProcessingRun({
      clientId,
      employeeId: "emp-complete-review",
      businessDate: "2026-07-21",
      timezone: "UTC",
      punchIds: [],
      engineVersion: "test-engine-1",
    });

    const finalState = createInitialState("2026-07-21", "UTC", []);

    const completed = await completeProcessingRun(run.runId, {
      resolvedLayers: [],
      unresolvedLevels: ["DEPARTMENT"],
      unresolvedRefs: [{ targetType: "LOCATION", ref: "site-123" }],
      finalState,
      flags: [],
    });

    expect(completed.status).toBe("needs_review");
    expect(completed.unresolvedLevels).toEqual(["DEPARTMENT"]);
    expect(completed.unresolvedRefs).toEqual([{ targetType: "LOCATION", ref: "site-123" }]);
  });

  it("completeProcessingRun throws NotFoundError for a missing runId", async () => {
    const finalState = createInitialState("2026-07-21", "UTC", []);
    await expect(
      completeProcessingRun("does-not-exist", {
        resolvedLayers: [],
        unresolvedLevels: [],
        unresolvedRefs: [],
        finalState,
        flags: [],
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("failProcessingRun sets runStatus 'failed' and status 'error' with the given errorMessage", async () => {
    const clientId = new Types.ObjectId().toString();
    const run = await createProcessingRun({
      clientId,
      employeeId: "emp-fail-1",
      businessDate: "2026-07-21",
      timezone: "UTC",
      punchIds: [],
      engineVersion: "test-engine-1",
    });

    await failProcessingRun(run.runId, "something went wrong");

    const doc = await ProcessingRun.findOne({ runId: run.runId }).lean();
    expect(doc).not.toBeNull();
    expect(doc!.runStatus).toBe("failed");
    expect(doc!.status).toBe("error");
    expect(doc!.errorMessage).toBe("something went wrong");
    expect(doc!.completedAt).toBeInstanceOf(Date);
  });

  it("getProcessingRun respects the tenant filter — a run from a different clientId isn't visible", async () => {
    const clientId = new Types.ObjectId().toString();
    const otherClientId = new Types.ObjectId().toString();

    const run = await createProcessingRun({
      clientId,
      employeeId: "emp-tenant-1",
      businessDate: "2026-07-21",
      timezone: "UTC",
      punchIds: [],
      engineVersion: "test-engine-1",
    });

    const found = await getProcessingRun(run.runId, { clientId: new Types.ObjectId(clientId) });
    expect(found.runId).toBe(run.runId);

    await expect(getProcessingRun(run.runId, { clientId: new Types.ObjectId(otherClientId) })).rejects.toThrow(
      NotFoundError
    );
  });

  it("getProcessingRun throws NotFoundError for a missing runId", async () => {
    await expect(getProcessingRun("no-such-run-id", {})).rejects.toThrow(NotFoundError);
  });
});
