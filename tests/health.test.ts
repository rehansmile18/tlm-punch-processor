import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { Router } from "express";
import { setupTestContext, seedAuthedUser, authed, TestContext } from "./helpers";
import { authenticate } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/errorHandler";

describe("smoke test: app boots, health check", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestContext();
  });
  afterAll(() => ctx.teardown());

  it("GET /health reports db up (mock TLM reachability is also up)", async () => {
    const res = await authed(ctx.app, "irrelevant").get("/health");
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("up");
    expect(res.body.ruleRepository).toBe("up");
  });

  it("rejects a made-up route with no valid token as 401 (auth runs before route matching, same as TLM)", async () => {
    const res = await authed(ctx.app, "not-a-real-token").get("/api/v1/totally-made-up-route");
    expect(res.status).toBe(401);
  });

  it("returns 404 (not 500) for a made-up route once authenticated", async () => {
    const token = seedAuthedUser({ role: "PLATFORM_ADMIN", clientId: null });
    const res = await authed(ctx.app, token).get("/api/v1/totally-made-up-route");
    expect(res.status).toBe(404);
  });
});

describe("smoke test: authenticate middleware resolves live role/clientId via the mocked TLM GET /users/me", () => {
  it("rejects a request with no Authorization header", async () => {
    const express = (await import("express")).default;
    const app = express();
    const probe = Router();
    probe.get("/probe", authenticate, (req, res) => res.json({ auth: req.auth }));
    app.use(probe);
    app.use(errorHandler);

    const res = await request(app).get("/probe");
    expect(res.status).toBe(401);
  });

  it("resolves role/clientId for a valid, mock-registered token", async () => {
    const express = (await import("express")).default;
    const app = express();
    const probe = Router();
    probe.get("/probe", authenticate, (req, res) => res.json({ auth: req.auth }));
    app.use(probe);
    app.use(errorHandler);

    const token = seedAuthedUser({ role: "CLIENT_ADMIN", clientId: "64b000000000000000000001" });
    const res = await request(app).get("/probe").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.auth.role).toBe("CLIENT_ADMIN");
    expect(res.body.auth.clientId).toBe("64b000000000000000000001");
  });

  it("rejects a token for a profile the mock TLM reports as disabled", async () => {
    const express = (await import("express")).default;
    const app = express();
    const probe = Router();
    probe.get("/probe", authenticate, (req, res) => res.json({ auth: req.auth }));
    app.use(probe);
    app.use(errorHandler);

    const token = seedAuthedUser({ role: "VIEWER", clientId: "64b000000000000000000001", status: "disabled" });
    const res = await request(app).get("/probe").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
