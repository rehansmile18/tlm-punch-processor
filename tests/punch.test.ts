import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, seedAuthedUser, authed, withPunchIngestKey, TestContext } from "./helpers";
import { Employee } from "../src/models/employee.model";
import { Site } from "../src/models/site.model";

describe("punch ingestion", () => {
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

    await Employee.create({ clientId: new Types.ObjectId(clientId), employeeId: "emp-1", timezone: "America/Los_Angeles" });
    await Site.create({ clientId: new Types.ObjectId(clientId), siteId: "site-1", name: "Main Site", timezone: "America/Los_Angeles" });
  });
  afterAll(() => ctx.teardown());

  it("creates a punch with a clockOut (status closed)", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/punches", {
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-05T09:00:00.000Z",
      clockOut: "2026-01-05T17:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("closed");
  });

  it("creates a punch with no clockOut yet (status open)", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/punches", {
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-06T09:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("open");
    expect(res.body.clockOut).toBeNull();
  });

  it("rejects clockOut before clockIn", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/punches", {
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-05T17:00:00.000Z",
      clockOut: "2026-01-05T09:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown employeeId", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/punches", {
      clientId,
      employeeId: "emp-unknown",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-05T09:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown siteId", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/punches", {
      clientId,
      employeeId: "emp-1",
      siteId: "site-unknown",
      task: "Stocking",
      clockIn: "2026-01-05T09:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(400);
  });

  it("rejects creating for a clientId that isn't the caller's own", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/punches", {
      clientId: otherClientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-05T09:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(403);
  });

  it("accepts punches via a punch-ingest key, without any human JWT", async () => {
    const res = await withPunchIngestKey(ctx.app).post("/api/v1/punches", {
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-07T09:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(201);
  });

  it("rejects a wrong punch-ingest key", async () => {
    const res = await withPunchIngestKey(ctx.app, "wrong-key").post("/api/v1/punches", {
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-07T09:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(401);
  });

  it("rejects a punch-ingest credential trying to LIST punches (read requires a real user)", async () => {
    const res = await withPunchIngestKey(ctx.app).post("/api/v1/punches/bulk", {
      punches: [
        {
          clientId,
          employeeId: "emp-1",
          siteId: "site-1",
          task: "Stocking",
          clockIn: "2026-01-08T09:00:00.000Z",
          timezone: "America/Los_Angeles",
        },
      ],
    });
    expect(res.status).toBe(207);
  });

  it("bulk-creates with partial success (one bad punch doesn't fail the rest)", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/punches/bulk", {
      punches: [
        {
          clientId,
          employeeId: "emp-1",
          siteId: "site-1",
          task: "Stocking",
          clockIn: "2026-01-09T09:00:00.000Z",
          timezone: "America/Los_Angeles",
        },
        {
          clientId,
          employeeId: "emp-unknown",
          siteId: "site-1",
          task: "Stocking",
          clockIn: "2026-01-09T09:00:00.000Z",
          timezone: "America/Los_Angeles",
        },
      ],
    });
    expect(res.status).toBe(207);
    expect(res.body.accepted).toHaveLength(1);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].index).toBe(1);
  });

  it("lists punches scoped to the caller's own client, filterable by employeeId", async () => {
    const res = await authed(ctx.app, adminToken).get("/api/v1/punches?employeeId=emp-1");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((p: { employeeId: string }) => p.employeeId === "emp-1")).toBe(true);

    const otherRes = await authed(ctx.app, otherClientAdminToken).get("/api/v1/punches");
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.items).toHaveLength(0);
  });

  it("corrects a punch: creates a new punch, marks the original as corrected, never mutates the original's fields", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/punches", {
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-10T09:00:00.000Z",
      clockOut: "2026-01-10T17:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    const originalId = created.body._id;

    const corrected = await authed(ctx.app, adminToken).patch(`/api/v1/punches/${originalId}`, {
      clockOut: "2026-01-10T17:30:00.000Z",
    });
    expect(corrected.status).toBe(201);
    expect(corrected.body.correctionOfPunchId).toBe(originalId);
    expect(corrected.body.clockOut).toBe("2026-01-10T17:30:00.000Z");

    const original = await authed(ctx.app, adminToken).get(`/api/v1/punches/${originalId}`);
    expect(original.body.status).toBe("corrected");
    expect(original.body.clockOut).toBe("2026-01-10T17:00:00.000Z"); // untouched
  });

  it("rejects a correction where the resulting clockOut would be before clockIn", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/punches", {
      clientId,
      employeeId: "emp-1",
      siteId: "site-1",
      task: "Stocking",
      clockIn: "2026-01-11T09:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    const res = await authed(ctx.app, adminToken).patch(`/api/v1/punches/${created.body._id}`, {
      clockOut: "2026-01-11T08:00:00.000Z",
    });
    expect(res.status).toBe(400);
  });
});
