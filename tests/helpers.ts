import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/app";
import { ruleRepoConnection } from "../src/config/db";
import { env } from "../src/config/env";
import { registerMockProfile, resetMockRuleRepo, type MockProfile } from "./mockRuleRepo";

export interface TestContext {
  app: ReturnType<typeof createApp>;
  mongod: MongoMemoryServer;
  teardown: () => Promise<void>;
}

// A single in-memory Mongo SERVER, but two separate logical databases/connections on it —
// mirrors production's two-database split (this service's own processing state on the default
// connection, TLM's own database on ruleRepoConnection — see config/db.ts) without spawning a
// second mongod process per test file, which was enough concurrent-process contention across the
// whole suite to cause intermittent request timeouts.
export async function setupTestContext(): Promise<TestContext> {
  const mongod = await MongoMemoryServer.create();
  await Promise.all([
    mongoose.connect(mongod.getUri("tlm_punch_processor_test")),
    ruleRepoConnection.openUri(mongod.getUri("tlm_rule_repository_test")),
  ]);
  // Index builds (e.g. the unique {clientId, siteId} index) run in the background after connecting
  // and are NOT awaited by connect()/openUri() themselves — without this, a test's very first
  // requests can race a still-building unique index and see it silently not enforced yet.
  await Promise.all([
    ...Object.values(mongoose.connection.models).map((m) => m.init()),
    ...Object.values(ruleRepoConnection.models).map((m) => m.init()),
  ]);
  const app = createApp();
  return {
    app,
    mongod,
    teardown: async () => {
      resetMockRuleRepo();
      await Promise.all([mongoose.disconnect(), ruleRepoConnection.close()]);
      await mongod.stop();
    },
  };
}

/**
 * Mints a locally-signed JWT with the same shape/secret TLM would issue (this service never
 * mints its own tokens), and registers the profile TLM's GET /users/me would return for it —
 * so `authenticate` resolves role/clientId without needing a real TLM instance.
 */
export function seedAuthedUser(profile: MockProfile): string {
  const userId = randomUUID();
  const token = jwt.sign({ userId }, env.jwtSecret, { algorithm: "HS256" });
  registerMockProfile(token, profile);
  return token;
}

export function authed(app: TestContext["app"], token: string) {
  return {
    get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string, body?: object) => request(app).post(url).set("Authorization", `Bearer ${token}`).send(body),
    patch: (url: string, body?: object) => request(app).patch(url).set("Authorization", `Bearer ${token}`).send(body),
    delete: (url: string) => request(app).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

export function withPunchIngestKey(app: TestContext["app"], key = "test-ingest-key") {
  return {
    post: (url: string, body?: object) => request(app).post(url).set("X-Punch-Ingest-Key", key).send(body),
  };
}
