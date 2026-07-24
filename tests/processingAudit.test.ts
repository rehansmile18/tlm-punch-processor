import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, TestContext } from "./helpers";
import {
  recordAuditSteps,
  getAuditTrailForRun,
  PipelineStepResult,
} from "../src/modules/processing/processingAudit.service";
import { createInitialState } from "../src/engine/types";

function makeStep(sequenceIndex: number, overrides: Partial<PipelineStepResult> = {}): PipelineStepResult {
  const state = createInitialState("2026-07-21", "UTC", []);
  return {
    sequenceIndex,
    sourceAssignment: {
      assignmentId: `assignment-${sequenceIndex}`,
      targetType: "EMPLOYEE",
      priority: 1,
      ruleGroupId: `rg-${sequenceIndex}`,
      ruleGroupVersion: 1,
    },
    policyId: `policy-${sequenceIndex}`,
    policyType: "OVERTIME",
    policyVersion: 1,
    inputState: state,
    outputState: state,
    humanReadableSummary: `step ${sequenceIndex} summary`,
    durationMs: 5,
    ...overrides,
  };
}

describe("processingAudit service", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestContext();
  });
  afterAll(() => ctx.teardown());

  it("recordAuditSteps inserts the correct number of entries with correct sequenceIndex/fields", async () => {
    const runId = new Types.ObjectId();
    const steps = [makeStep(0), makeStep(1), makeStep(2)];

    await recordAuditSteps(runId, steps);

    const entries = await getAuditTrailForRun(runId);
    expect(entries).toHaveLength(3);
    entries.forEach((entry, i) => {
      expect(entry.runId.toString()).toBe(runId.toString());
      expect(entry.sequenceIndex).toBe(i);
      expect(entry.policyId).toBe(steps[i].policyId);
      expect(entry.policyType).toBe(steps[i].policyType);
      expect(entry.policyVersion).toBe(steps[i].policyVersion);
      expect(entry.sourceAssignment).toEqual(steps[i].sourceAssignment);
      expect(entry.humanReadableSummary).toBe(steps[i].humanReadableSummary);
      expect(entry.durationMs).toBe(steps[i].durationMs);
      expect(entry.createdAt).toBeInstanceOf(Date);
    });
  });

  it("getAuditTrailForRun returns entries sorted by sequenceIndex", async () => {
    const runId = new Types.ObjectId();
    // Insert out of order to prove the sort, not insertion order, drives the result.
    const steps = [makeStep(2), makeStep(0), makeStep(1)];

    await recordAuditSteps(runId, steps);

    const entries = await getAuditTrailForRun(runId);
    expect(entries.map((e) => e.sequenceIndex)).toEqual([0, 1, 2]);
  });

  it("two different runs' entries don't leak into each other's audit trail", async () => {
    const runIdA = new Types.ObjectId();
    const runIdB = new Types.ObjectId();

    await recordAuditSteps(runIdA, [makeStep(0), makeStep(1)]);
    await recordAuditSteps(runIdB, [makeStep(0)]);

    const entriesA = await getAuditTrailForRun(runIdA);
    const entriesB = await getAuditTrailForRun(runIdB);

    expect(entriesA).toHaveLength(2);
    expect(entriesB).toHaveLength(1);
    expect(entriesA.every((e) => e.runId.toString() === runIdA.toString())).toBe(true);
    expect(entriesB.every((e) => e.runId.toString() === runIdB.toString())).toBe(true);
  });

  it("recordAuditSteps is a no-op for an empty steps array", async () => {
    const runId = new Types.ObjectId();
    await recordAuditSteps(runId, []);
    const entries = await getAuditTrailForRun(runId);
    expect(entries).toHaveLength(0);
  });
});
