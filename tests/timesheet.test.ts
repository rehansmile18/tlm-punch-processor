import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Types } from "mongoose";
import { setupTestContext, seedAuthedUser, authed, TestContext } from "./helpers";
import { Timesheet } from "../src/models/timesheet.model";
import { ProcessingAuditEntry } from "../src/models/processingAudit.model";
import { PayPeriodConfig } from "../src/models/payPeriodConfig.model";
import { createTimesheetVersion } from "../src/modules/timesheet/timesheet.service";

function seedAuditEntry(runId: Types.ObjectId, sequenceIndex: number) {
  return ProcessingAuditEntry.create({
    runId,
    sequenceIndex,
    sourceAssignment: { assignmentId: new Types.ObjectId(), targetType: "EMPLOYEE", priority: 10, ruleGroupId: "rg-1", ruleGroupVersion: 1 },
    policyId: "policy-1",
    policyType: "RATE",
    policyVersion: 1,
    inputState: {},
    outputState: {},
    humanReadableSummary: `step ${sequenceIndex} for run ${runId}`,
    durationMs: 1,
  });
}

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

  describe("getTimesheetAuditTrail", () => {
    it("gathers steps across every distinct runId referenced by the timesheet's lines, tagged with each line's businessDate", async () => {
      const day1RunId = new Types.ObjectId();
      const day2RunId = new Types.ObjectId();
      await seedAuditEntry(day1RunId, 0);
      await seedAuditEntry(day2RunId, 0);
      await seedAuditEntry(day2RunId, 1);

      const doc = await seedTimesheet({
        clientId: new Types.ObjectId(clientId),
        employeeId: "audit-emp",
        runId: day2RunId,
        lines: [
          {
            businessDate: "2026-07-06",
            siteId: "site-1",
            employeeId: "audit-emp",
            task: "Stocking",
            rate: 20,
            rateType: "hourly",
            dailyAmount: 160,
            additionalAmount: 0,
            additionalHours: 0,
            totalHours: 8,
            totalAmount: 160,
            runId: day1RunId,
          },
          {
            businessDate: "2026-07-07",
            siteId: "site-1",
            employeeId: "audit-emp",
            task: "Stocking",
            rate: 20,
            rateType: "hourly",
            dailyAmount: 160,
            additionalAmount: 0,
            additionalHours: 0,
            totalHours: 8,
            totalAmount: 160,
            runId: day2RunId,
          },
        ],
      });

      const res = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/${doc._id}/audit-trail`);
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(3);
      const byDate = res.body.entries.map((e: { businessDate: string }) => e.businessDate);
      expect(byDate.filter((d: string) => d === "2026-07-06")).toHaveLength(1);
      expect(byDate.filter((d: string) => d === "2026-07-07")).toHaveLength(2);
    });

    it("falls back to the top-level runId when lines is empty (e.g. a salaried period)", async () => {
      const runId = new Types.ObjectId();
      await seedAuditEntry(runId, 0);
      const doc = await seedTimesheet({ clientId: new Types.ObjectId(clientId), employeeId: "salaried-emp", runId, lines: [] });

      const res = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/${doc._id}/audit-trail`);
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].businessDate).toBeNull();
    });

    it("404s for a cross-tenant id", async () => {
      const doc = await seedTimesheet({ clientId: new Types.ObjectId(otherClientId), employeeId: "audit-cross-emp" });
      const res = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/${doc._id}/audit-trail`);
      expect(res.status).toBe(404);
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

  describe("site-grouped timesheets", () => {
    function line(overrides: Record<string, unknown>) {
      return {
        businessDate: "2026-08-03",
        siteId: "site-a",
        employeeId: "grid-emp",
        task: "Cleaning",
        rate: 20,
        rateType: "hourly" as const,
        dailyAmount: 160,
        additionalAmount: 0,
        additionalHours: 0,
        totalHours: 8,
        totalAmount: 160,
        runId: new Types.ObjectId(),
        ...overrides,
      };
    }

    it("periodEndDate is the period's own last calendar day, not a timezone-shifted reading of the stored instant", async () => {
      // Regression: periodEnd is stored as 2026-01-11T23:59:59.999Z. A naive Date-instant read of
      // that in a positive-UTC-offset timezone rounds forward to "Jan 12" — which is exactly what
      // a user reported seeing as the displayed period end for a period that only ever ran Mon
      // Jan 5 through Sun Jan 11.
      const regressionClientId = new Types.ObjectId(clientId);
      const config = await PayPeriodConfig.create({
        clientId: regressionClientId,
        name: "Weekly (period-end regression)",
        cadence: "weekly",
        timezone: "UTC",
        weekStartDay: 1, // Monday
        payDateOffsetDays: 5,
        producesHourlyLines: true,
      });
      const payPeriodId = `W-${config._id}-2026-01-05`;
      const doc = await seedTimesheet({
        clientId: regressionClientId,
        employeeId: "period-end-emp",
        payPeriodId,
        periodStart: new Date("2026-01-05T00:00:00.000Z"),
        periodEnd: new Date("2026-01-11T23:59:59.999Z"),
        lines: [line({ employeeId: "period-end-emp", businessDate: "2026-01-05", siteId: "site-period-end" })],
      });

      const getRes = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/${doc._id}`);
      expect(getRes.body.periodStartDate).toBe("2026-01-05");
      expect(getRes.body.periodEndDate).toBe("2026-01-11");

      const listRes = await authed(ctx.app, adminToken).get(`/api/v1/timesheets?payPeriodId=${payPeriodId}`);
      expect(listRes.body.items[0].periodEndDate).toBe("2026-01-11");

      const groupRes = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/by-site?payPeriodId=${payPeriodId}`);
      expect(groupRes.body.items[0].periodEndDate).toBe("2026-01-11");

      const gridRes = await authed(ctx.app, adminToken).get(
        `/api/v1/timesheets/by-site/site-period-end/${payPeriodId}`
      );
      expect(gridRes.body.periodEndDate).toBe("2026-01-11");
      expect(gridRes.body.dates).toEqual(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"]);
    });

    it("groups multiple employees' timesheets by (siteId, payPeriodId), summing only that site's lines", async () => {
      const groupClientId = new Types.ObjectId(clientId);
      const config = await PayPeriodConfig.create({
        clientId: groupClientId,
        name: "Weekly (group test)",
        cadence: "weekly",
        timezone: "UTC",
        weekStartDay: 1,
        payDateOffsetDays: 5,
        producesHourlyLines: true,
      });
      const payPeriodId = `W-${config._id}-2026-08-03`;

      // emp-1 works only at site-a; emp-2 splits across site-a and site-b in the same period.
      await seedTimesheet({
        clientId: groupClientId,
        employeeId: "group-emp-1",
        payPeriodId,
        periodStart: new Date("2026-08-03"),
        periodEnd: new Date("2026-08-09"),
        lines: [line({ employeeId: "group-emp-1", businessDate: "2026-08-03", siteId: "site-a", totalHours: 8, totalAmount: 160 })],
        totalHours: 8,
        totalAmount: 160,
      });
      await seedTimesheet({
        clientId: groupClientId,
        employeeId: "group-emp-2",
        payPeriodId,
        periodStart: new Date("2026-08-03"),
        periodEnd: new Date("2026-08-09"),
        lines: [
          line({ employeeId: "group-emp-2", businessDate: "2026-08-03", siteId: "site-a", totalHours: 6, totalAmount: 120 }),
          line({ employeeId: "group-emp-2", businessDate: "2026-08-04", siteId: "site-b", totalHours: 7, totalAmount: 140 }),
        ],
        totalHours: 13,
        totalAmount: 260,
      });

      const listRes = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/by-site?payPeriodId=${payPeriodId}`);
      expect(listRes.status).toBe(200);
      const groups = listRes.body.items as { siteId: string; employeeCount: number; totalHours: number; totalAmount: number }[];
      const siteA = groups.find((g) => g.siteId === "site-a");
      const siteB = groups.find((g) => g.siteId === "site-b");
      expect(siteA).toMatchObject({ employeeCount: 2, totalHours: 14, totalAmount: 280 });
      expect(siteB).toMatchObject({ employeeCount: 1, totalHours: 7, totalAmount: 140 });

      const siteFilteredRes = await authed(ctx.app, adminToken).get(
        `/api/v1/timesheets/by-site?payPeriodId=${payPeriodId}&siteId=site-a`
      );
      expect(siteFilteredRes.body.items).toHaveLength(1);
      expect(siteFilteredRes.body.items[0].siteId).toBe("site-a");
    });

    it("builds a grid with one row per employee at that site, cells only for that site's lines, and dates spanning the full period", async () => {
      const gridClientId = new Types.ObjectId(clientId);
      const config = await PayPeriodConfig.create({
        clientId: gridClientId,
        name: "Weekly (grid test)",
        cadence: "weekly",
        timezone: "UTC",
        weekStartDay: 1,
        payDateOffsetDays: 5,
        producesHourlyLines: true,
      });
      const payPeriodId = `W-${config._id}-2026-08-03`;

      await seedTimesheet({
        clientId: gridClientId,
        employeeId: "grid-emp-1",
        payPeriodId,
        periodStart: new Date("2026-08-03"),
        periodEnd: new Date("2026-08-09"),
        lines: [
          line({ employeeId: "grid-emp-1", businessDate: "2026-08-03", siteId: "site-grid", task: "Cleaning" }),
          line({ employeeId: "grid-emp-1", businessDate: "2026-08-04", siteId: "site-grid", task: "Cleaning" }),
        ],
        totalHours: 16,
        totalAmount: 320,
      });
      // Works elsewhere this period — should NOT show up in site-grid's grid at all.
      await seedTimesheet({
        clientId: gridClientId,
        employeeId: "grid-emp-2",
        payPeriodId,
        periodStart: new Date("2026-08-03"),
        periodEnd: new Date("2026-08-09"),
        lines: [line({ employeeId: "grid-emp-2", businessDate: "2026-08-05", siteId: "site-other" })],
        totalHours: 8,
        totalAmount: 160,
      });

      const res = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/by-site/site-grid/${payPeriodId}`);
      expect(res.status).toBe(200);
      expect(res.body.dates).toEqual([
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
      ]);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].employeeId).toBe("grid-emp-1");
      expect(res.body.rows[0].totalHours).toBe(16);
      expect(Object.keys(res.body.rows[0].cellsByDate).sort()).toEqual(["2026-08-03", "2026-08-04"]);
      expect(res.body.rows[0].cellsByDate["2026-08-03"]).toMatchObject({ task: "Cleaning", totalHours: 8 });
      expect(res.body.totals).toMatchObject({ employeeCount: 1, totalHours: 16, totalAmount: 320 });
    });

    it("404s for a site+period with no matching timesheets", async () => {
      const res = await authed(ctx.app, adminToken).get("/api/v1/timesheets/by-site/no-such-site/no-such-period");
      expect(res.status).toBe(404);
    });

    it("scopes both endpoints to the caller's own client", async () => {
      const otherClient = new Types.ObjectId(otherClientId);
      const config = await PayPeriodConfig.create({
        clientId: otherClient,
        name: "Weekly (cross-tenant test)",
        cadence: "weekly",
        timezone: "UTC",
        weekStartDay: 1,
        payDateOffsetDays: 5,
        producesHourlyLines: true,
      });
      const payPeriodId = `W-${config._id}-2026-08-03`;
      await seedTimesheet({
        clientId: otherClient,
        employeeId: "cross-tenant-emp",
        payPeriodId,
        periodStart: new Date("2026-08-03"),
        periodEnd: new Date("2026-08-09"),
        lines: [line({ employeeId: "cross-tenant-emp", siteId: "cross-tenant-site" })],
      });

      const listRes = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/by-site?payPeriodId=${payPeriodId}`);
      expect(listRes.body.items).toHaveLength(0);

      const gridRes = await authed(ctx.app, adminToken).get(`/api/v1/timesheets/by-site/cross-tenant-site/${payPeriodId}`);
      expect(gridRes.status).toBe(404);

      const ownGridRes = await authed(ctx.app, otherClientAdminToken).get(
        `/api/v1/timesheets/by-site/cross-tenant-site/${payPeriodId}`
      );
      expect(ownGridRes.status).toBe(200);
    });
  });
});
