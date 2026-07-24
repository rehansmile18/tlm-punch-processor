import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, seedAuthedUser, authed, TestContext } from "./helpers";
import { PayPeriodConfig } from "../src/models/payPeriodConfig.model";

describe("employeeGroup CRUD", () => {
  let ctx: TestContext;
  let clientId: string;
  let otherClientId: string;
  let adminToken: string;
  let otherClientAdminToken: string;
  let payPeriodConfigId: string;

  beforeAll(async () => {
    ctx = await setupTestContext();
    clientId = new Types.ObjectId().toString();
    otherClientId = new Types.ObjectId().toString();
    adminToken = seedAuthedUser({ role: "CLIENT_ADMIN", clientId });
    otherClientAdminToken = seedAuthedUser({ role: "CLIENT_ADMIN", clientId: otherClientId });

    const payPeriodConfig = await PayPeriodConfig.create({
      clientId: new Types.ObjectId(clientId),
      name: "Biweekly",
      cadence: "biweekly",
      timezone: "America/New_York",
      weekStartDay: 0,
      anchorDate: "2026-01-04",
    });
    payPeriodConfigId = String(payPeriodConfig._id);
  });
  afterAll(() => ctx.teardown());

  it("creates an employee group", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employee-groups", {
      clientId,
      name: "Warehouse Staff",
      payPeriodConfigId,
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Warehouse Staff");
    expect(res.body.payPeriodConfigId).toBe(payPeriodConfigId);
  });

  it("rejects a non-existent payPeriodConfigId", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employee-groups", {
      clientId,
      name: "Office Staff",
      payPeriodConfigId: new Types.ObjectId().toString(),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a payPeriodConfigId belonging to a different client", async () => {
    const otherConfig = await PayPeriodConfig.create({
      clientId: new Types.ObjectId(otherClientId),
      name: "Other Co Weekly",
      cadence: "weekly",
      timezone: "UTC",
      weekStartDay: 1,
    });
    const res = await authed(ctx.app, adminToken).post("/api/v1/employee-groups", {
      clientId,
      name: "Office Staff",
      payPeriodConfigId: String(otherConfig._id),
    });
    expect(res.status).toBe(400);
  });

  it("rejects creating for a clientId that isn't the caller's own", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employee-groups", {
      clientId: otherClientId,
      name: "Sneaky Group",
      payPeriodConfigId,
    });
    expect(res.status).toBe(403);
  });

  it("rejects a duplicate name within the same client", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employee-groups", {
      clientId,
      name: "Warehouse Staff",
      payPeriodConfigId,
    });
    expect(res.status).toBe(409);
  });

  it("lists employee groups scoped to the caller's own client only", async () => {
    const res = await authed(ctx.app, adminToken).get("/api/v1/employee-groups");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);

    const otherRes = await authed(ctx.app, otherClientAdminToken).get("/api/v1/employee-groups");
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.items).toHaveLength(0);
  });

  it("gets and patches an employee group", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/employee-groups", {
      clientId,
      name: "Delivery Staff",
      payPeriodConfigId,
    });
    const id = created.body._id;

    const got = await authed(ctx.app, adminToken).get(`/api/v1/employee-groups/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe("Delivery Staff");

    const patched = await authed(ctx.app, adminToken).patch(`/api/v1/employee-groups/${id}`, { name: "Delivery Team" });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe("Delivery Team");
  });

  it("rejects a cross-client write attempt on an existing group (403)", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/employee-groups", {
      clientId,
      name: "Night Shift",
      payPeriodConfigId,
    });
    const id = created.body._id;
    const res = await authed(ctx.app, otherClientAdminToken).patch(`/api/v1/employee-groups/${id}`, { name: "Hijacked" });
    expect(res.status).toBe(404);
  });
});
