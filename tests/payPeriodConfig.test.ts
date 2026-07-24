import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, seedAuthedUser, authed, TestContext } from "./helpers";

describe("payPeriodConfig CRUD", () => {
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

  it("rejects a weekly config with no weekStartDay", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "Bad Weekly",
      cadence: "weekly",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a biweekly config with no anchorDate", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "Bad Biweekly",
      cadence: "biweekly",
      timezone: "America/Los_Angeles",
      weekStartDay: 1,
    });
    expect(res.status).toBe(400);
  });

  it("creates a valid weekly config", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "Standard Weekly",
      cadence: "weekly",
      timezone: "America/Los_Angeles",
      weekStartDay: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.producesHourlyLines).toBe(true);
  });

  it("defaults producesHourlyLines to false for a salaried config when not specified", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "Salaried Monthly",
      cadence: "salaried",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(201);
    expect(res.body.producesHourlyLines).toBe(false);
  });

  it("defaults producesHourlyLines to true for a monthly config when not specified", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "Standard Monthly",
      cadence: "monthly",
      timezone: "America/Los_Angeles",
    });
    expect(res.status).toBe(201);
    expect(res.body.producesHourlyLines).toBe(true);
  });

  it("respects an explicit producesHourlyLines override", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "Salaried With Hours",
      cadence: "salaried",
      timezone: "America/Los_Angeles",
      producesHourlyLines: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.producesHourlyLines).toBe(true);
  });

  it("rejects a non-existent payCalendarId", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "With Bad Calendar",
      cadence: "monthly",
      timezone: "UTC",
      payCalendarId: new Types.ObjectId().toString(),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a payCalendarId belonging to a different client", async () => {
    const otherCalendar = await authed(ctx.app, otherClientAdminToken).post("/api/v1/payroll-calendars", {
      clientId: otherClientId,
      name: "Other Co Calendar",
      rows: [],
    });
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "Cross Tenant Calendar",
      cadence: "monthly",
      timezone: "UTC",
      payCalendarId: otherCalendar.body._id,
    });
    expect(res.status).toBe(400);
  });

  it("rejects creating for a clientId that isn't the caller's own", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId: otherClientId,
      name: "Sneaky",
      cadence: "monthly",
      timezone: "UTC",
    });
    expect(res.status).toBe(403);
  });

  it("rejects a duplicate name within the same client", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/pay-period-configs", {
      clientId,
      name: "Standard Weekly",
      cadence: "monthly",
      timezone: "UTC",
    });
    expect(res.status).toBe(409);
  });

  it("lists pay period configs scoped to the caller's own client only", async () => {
    const res = await authed(ctx.app, adminToken).get("/api/v1/pay-period-configs");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);

    const otherRes = await authed(ctx.app, otherClientAdminToken).get("/api/v1/pay-period-configs");
    expect(otherRes.status).toBe(200);
    // otherClient only has whatever it created for the payCalendarId FK test — none for pay-period-configs.
    expect(otherRes.body.items).toHaveLength(0);
  });
});

describe("payrollCalendar CRUD", () => {
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

  it("creates a payroll calendar with rows", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/payroll-calendars", {
      clientId,
      name: "2026 Calendar",
      rows: [{ periodEnd: "2026-01-31", payDate: "2026-02-06" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.rows).toHaveLength(1);
  });

  it("rejects creating for a clientId that isn't the caller's own", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/payroll-calendars", {
      clientId: otherClientId,
      name: "Sneaky Calendar",
      rows: [],
    });
    expect(res.status).toBe(403);
  });

  it("rejects a duplicate name within the same client", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/payroll-calendars", {
      clientId,
      name: "2026 Calendar",
      rows: [],
    });
    expect(res.status).toBe(409);
  });

  it("gets and patches a payroll calendar (replacing rows)", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/payroll-calendars", {
      clientId,
      name: "2027 Calendar",
      rows: [{ periodEnd: "2027-01-31", payDate: "2027-02-05" }],
    });
    const id = created.body._id;

    const got = await authed(ctx.app, adminToken).get(`/api/v1/payroll-calendars/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.rows).toHaveLength(1);

    const patched = await authed(ctx.app, adminToken).patch(`/api/v1/payroll-calendars/${id}`, {
      rows: [
        { periodEnd: "2027-01-31", payDate: "2027-02-05" },
        { periodEnd: "2027-02-28", payDate: "2027-03-05" },
      ],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.rows).toHaveLength(2);
  });

  it("rejects a cross-client patch attempt (404, not visible under the caller's tenant filter)", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/payroll-calendars", {
      clientId,
      name: "2028 Calendar",
      rows: [],
    });
    const id = created.body._id;
    const res = await authed(ctx.app, otherClientAdminToken).patch(`/api/v1/payroll-calendars/${id}`, { name: "Hijacked" });
    expect(res.status).toBe(404);
  });
});
