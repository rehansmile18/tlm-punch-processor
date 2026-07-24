import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { registerMockProfile, resetMockRuleRepo, type MockProfile } from "./mockRuleRepo";

export interface TestContext {
  app: ReturnType<typeof createApp>;
  mongod: MongoMemoryServer;
  teardown: () => Promise<void>;
}

export async function setupTestContext(): Promise<TestContext> {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const app = createApp();
  return {
    app,
    mongod,
    teardown: async () => {
      resetMockRuleRepo();
      await mongoose.disconnect();
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
