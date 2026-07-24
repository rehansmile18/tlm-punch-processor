import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, seedAuthedUser, authed, TestContext } from "./helpers";
import { Timesheet } from "../src/models/timesheet.model";
import { createTimesheetVersion } from "../src/modules/timesheet/timesheet.service";

async function seedTimesheet(overrides: Record<string, unknown> = {}) {
  return Timesheet.create({
    clientId: new Types.ObjectId(),
    employeeId: "emp-1",
    payPeriodId: "2026-07-06_2026-07-19",
    periodStart: new Date("2026-07-06"),
    periodEnd: new Date("2026-07-19"),
    version: 1,
    status: "completed",
    runId: new Types.ObjectId(),
    lines: [],
    totalHours: 40,
    totalAmount: 800,
    payDate: new Date("2026-07-24"),
    ...overrides,
  });
}

describe("timesheet module", () => {
  let ctx: TestContext;
  let clientId: string;
  let otherClientId: string;
  let adminToken: string;
  let otherClientAdminToken: string;

  beforeAll(async () => {
    ctx = await setupTestContext();
    clientId = new Types.ObjectId().toString();
    otherClientId = new Types.ObjectId().toString();
    adminToken = seedAuthedUser({ role: "CLIENT_ADMIN", clientId });
    otherClientAdminToken = seedAuthedUser({ role: "CLIENT_ADMIN", clientId: otherClientId });
  });
  afterAll(() => ctx.teardown());

  describe("listTimesheets", () => {
    it("excludes superseded timesheets by default, includes them with includeSuperseded=true", async () => {
      const listClientId = new Types.ObjectId(clientId);
      await seedTimesheet({ clientId: listClientId, employeeId: "list-emp-1", status: "completed" });
      await seedTimesheet({ clientId: listClientId, employeeId: "list-emp-1", status: "superseded", version: 1 });

      const defaultRes = await authed(ctx.app, adminToken).get("/api/v1/timesheets?employeeId=list-emp-1");
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.items.length).toBe(1);
      expect(defaultRes.body.items[0].status).toBe("completed");

      const includeRes = await authed(ctx.app, adminToken).get(
        "/api/v1/timesheets?employeeId=list-emp-1&includeSuperseded=true"
      );
      expect(includeRes.status).toBe(200);
      expect(includeRes.body.items.length).toBe(2);

      const explicitStatusRes = await authed(ctx.app, adminToken).get(
        "/api/v1/timesheets?employeeId=list-emp-1&status=superseded"
      );
      expect(explicitStatusRes.status).toBe(200);
      expect(explicitStatusRes.body.items.length).toBe(1);
      expect(explicitStatusRes.body.items[0].status).toBe("superseded");
    });
  });

  describe("getTimesheet", () => {
    it("404s for a cross-tenant id", async () => {
      const doc = await seedTimesheet({ clientId: new Types.ObjectId(otherClientId) });
      const res = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/${doc._id}`);
      expect(res.status).toBe(404);

      const ownRes = await authed(ctx.app, otherClientAdminToken).get(`/api/v1/timesheets/${doc._id}`);
      expect(ownRes.status).toBe(200);
    });
  });

  describe("voidTimesheet", () => {
    it("flips status to voided, and rejects voiding an already-voided timesheet", async () => {
      const doc = await seedTimesheet({ clientId: new Types.ObjectId(clientId), employeeId: "void-emp" });

      const res = await authed(ctx.app, adminToken).post(`/api/v1/timesheets/${doc._id}/void`, {
        reason: "Corrected punch after finalization",
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("voided");

      const again = await authed(ctx.app, adminToken).post(`/api/v1/timesheets/${doc._id}/void`, {
        reason: "Trying again",
      });
      expect(again.status).toBe(400);
    });

    it("rejects a cross-client void attempt", async () => {
      const doc = await seedTimesheet({ clientId: new Types.ObjectId(clientId), employeeId: "void-cross-emp" });

      const res = await authed(ctx.app, otherClientAdminToken).post(`/api/v1/timesheets/${doc._id}/void`, {
        reason: "Not my timesheet",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("createTimesheetVersion", () => {
    it("creates version 1 with no supersession, then version 2 that supersedes it", async () => {
      const versionClientId = new Types.ObjectId();
      const runId1 = new Types.ObjectId();
      const runId2 = new Types.ObjectId();
      const baseInput = {
        clientId: versionClientId,
        employeeId: "version-emp",
        payPeriodId: "2026-07-06_2026-07-19",
        periodStart: new Date("2026-07-06"),
        periodEnd: new Date("2026-07-19"),
        payDate: new Date("2026-07-24"),
      };

      const v1 = await createTimesheetVersion({
        ...baseInput,
        runId: runId1,
        lines: [],
        totalHours: 40,
        totalAmount: 800,
      });
      expect(v1.version).toBe(1);
      expect(v1.status).toBe("completed");
      expect(v1.supersedesTimesheetId).toBeNull();

      const v2 = await createTimesheetVersion({
        ...baseInput,
        runId: runId2,
        lines: [],
        totalHours: 42,
        totalAmount: 840,
      });
      expect(v2.version).toBe(2);
      expect(v2.status).toBe("completed");
      expect(String(v2.supersedesTimesheetId)).toBe(String(v1._id));

      const reloadedV1 = await Timesheet.findById(v1._id).lean();
      expect(reloadedV1?.status).toBe("superseded");
    });
  });
});
