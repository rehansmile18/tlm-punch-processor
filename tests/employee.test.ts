import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, seedAuthedUser, authed, TestContext } from "./helpers";
import { EmployeeGroup } from "../src/models/employeeGroup.model";
import { PayPeriodConfig } from "../src/models/payPeriodConfig.model";

describe("employee CRUD", () => {
  let ctx: TestContext;
  let clientId: string;
  let otherClientId: string;
  let adminToken: string;
  let otherClientAdminToken: string;
  let employeeGroupId: string;
  let payPeriodConfigId: string;

  beforeAll(async () => {
    ctx = await setupTestContext();
    clientId = new Types.ObjectId().toString();
    otherClientId = new Types.ObjectId().toString();
    adminToken = seedAuthedUser({ role: "CLIENT_ADMIN", clientId });
    otherClientAdminToken = seedAuthedUser({ role: "CLIENT_ADMIN", clientId: otherClientId });

    const payPeriodConfig = await PayPeriodConfig.create({
      clientId: new Types.ObjectId(clientId),
      name: "Weekly",
      cadence: "weekly",
      timezone: "America/Los_Angeles",
      weekStartDay: 1,
    });
    payPeriodConfigId = String(payPeriodConfig._id);

    const employeeGroup = await EmployeeGroup.create({
      clientId: new Types.ObjectId(clientId),
      name: "Retail Staff",
      payPeriodConfigId: payPeriodConfig._id,
    });
    employeeGroupId = String(employeeGroup._id);
  });
  afterAll(() => ctx.teardown());

  it("creates an employee", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employees", {
      clientId,
      employeeId: "emp-1",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe("emp-1");
    expect(res.body.status).toBe("active");
  });

  it("creates an employee referencing a real employeeGroupId and payPeriodConfigId", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employees", {
      clientId,
      employeeId: "emp-2",
      timezone: "America/Los_Angeles",
      employeeGroupId,
      payPeriodConfigId,
    });
    expect(res.status).toBe(201);
    expect(res.body.employeeGroupId).toBe(employeeGroupId);
    expect(res.body.payPeriodConfigId).toBe(payPeriodConfigId);
  });

  it("rejects a non-existent employeeGroupId", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employees", {
      clientId,
      employeeId: "emp-3",
      timezone: "America/Los_Angeles",
      employeeGroupId: new Types.ObjectId().toString(),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an employeeGroupId belonging to a different client", async () => {
    const otherGroup = await EmployeeGroup.create({
      clientId: new Types.ObjectId(otherClientId),
      name: "Other Co Staff",
      payPeriodConfigId: new Types.ObjectId(payPeriodConfigId),
    });
    const res = await authed(ctx.app, adminToken).post("/api/v1/employees", {
      clientId,
      employeeId: "emp-4",
      timezone: "America/Los_Angeles",
      employeeGroupId: String(otherGroup._id),
    });
    expect(res.status).toBe(400);
  });

  it("rejects creating an employee for a clientId that isn't the caller's own", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employees", {
      clientId: otherClientId,
      employeeId: "emp-5",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(403);
  });

  it("rejects a duplicate employeeId within the same client", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/employees", {
      clientId,
      employeeId: "emp-1",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(409);
  });

  it("lists employees scoped to the caller's own client only", async () => {
    const res = await authed(ctx.app, adminToken).get("/api/v1/employees");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.items.every((e: { clientId: string }) => String(e.clientId) === clientId)).toBe(true);

    const otherRes = await authed(ctx.app, otherClientAdminToken).get("/api/v1/employees");
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.items).toHaveLength(0);
  });

  it("gets and patches an employee", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/employees", {
      clientId,
      employeeId: "emp-6",
      timezone: "America/Los_Angeles",
    });
    const id = created.body._id;

    const got = await authed(ctx.app, adminToken).get(`/api/v1/employees/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.employeeId).toBe("emp-6");

    const patched = await authed(ctx.app, adminToken).patch(`/api/v1/employees/${id}`, { status: "inactive" });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe("inactive");
  });

  it("rejects a cross-client patch attempt (404, since the doc isn't visible under the caller's tenant filter)", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/employees", {
      clientId,
      employeeId: "emp-7",
      timezone: "America/Los_Angeles",
    });
    const id = created.body._id;

    const res = await authed(ctx.app, otherClientAdminToken).patch(`/api/v1/employees/${id}`, { status: "inactive" });
    expect(res.status).toBe(404);
  });
});
