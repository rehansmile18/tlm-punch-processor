import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, seedAuthedUser, authed, TestContext } from "./helpers";

describe("task CRUD", () => {
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

  it("creates a task without a code", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/tasks", { clientId, name: "Stocking" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Stocking");
    expect(res.body.code).toBeNull();
  });

  it("creates a task with a code", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/tasks", { clientId, name: "Forklift Operation", code: "CDL" });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe("CDL");
  });

  it("rejects creating for a clientId that isn't the caller's own", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/tasks", { clientId: otherClientId, name: "Sneaky" });
    expect(res.status).toBe(403);
  });

  it("rejects a duplicate name within the same client", async () => {
    const res = await authed(ctx.app, adminToken).post("/api/v1/tasks", { clientId, name: "Stocking" });
    expect(res.status).toBe(409);
  });

  it("lists tasks scoped to the caller's own client only", async () => {
    const res = await authed(ctx.app, adminToken).get("/api/v1/tasks");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);

    const otherRes = await authed(ctx.app, otherClientAdminToken).get("/api/v1/tasks");
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.items).toHaveLength(0);
  });

  it("gets and patches a task", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/tasks", { clientId, name: "Cashiering" });
    const id = created.body._id;

    const got = await authed(ctx.app, adminToken).get(`/api/v1/tasks/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe("Cashiering");

    const patched = await authed(ctx.app, adminToken).patch(`/api/v1/tasks/${id}`, { code: "CASH" });
    expect(patched.status).toBe(200);
    expect(patched.body.code).toBe("CASH");
  });

  it("rejects a cross-client patch attempt (404, not visible under the caller's tenant filter)", async () => {
    const created = await authed(ctx.app, adminToken).post("/api/v1/tasks", { clientId, name: "Loading" });
    const id = created.body._id;
    const res = await authed(ctx.app, otherClientAdminToken).patch(`/api/v1/tasks/${id}`, { name: "Hijacked" });
    expect(res.status).toBe(404);
  });
});
