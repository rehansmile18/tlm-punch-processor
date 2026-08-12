import { env } from "../config/env";

// This service has no User collection of its own (see middleware/auth.ts) — what it actually
// needs to bootstrap is the one credential IT uses outbound: a PLATFORM_ADMIN service-account
// User in TLM. This script just ensures the account EXISTS; src/clients/ruleRepositoryClient.ts
// logs into it fresh on demand at runtime (via RULE_REPO_SERVICE_ACCOUNT_EMAIL/PASSWORD), so
// there's no JWT to mint or re-mint here. Mirrors TLM's own seed.ts in spirit (idempotent —
// "already exists, nothing to do" — minimal, clear console output) even though the entity being
// seeded lives in a different service's database.

const SEED_EMAIL = process.env.SEED_SERVICE_ACCOUNT_EMAIL ?? "svc-punch-processor@internal";
const SEED_PASSWORD = process.env.SEED_SERVICE_ACCOUNT_PASSWORD;

function printServiceAccountEnv(): void {
  console.log("\nSet these in this service's .env (this service logs in fresh on demand, so nothing here ever expires):\n");
  console.log(`RULE_REPO_SERVICE_ACCOUNT_EMAIL=${SEED_EMAIL}`);
  console.log(`RULE_REPO_SERVICE_ACCOUNT_PASSWORD=${SEED_PASSWORD}`);
}

async function main(): Promise<void> {
  if (!SEED_PASSWORD) {
    console.error("Set SEED_SERVICE_ACCOUNT_PASSWORD before running this script (a real password for the new TLM service-account user).");
    process.exit(1);
  }

  const base = env.ruleRepoBaseUrl;

  // Try logging in first — if the service-account user already exists, there's nothing to create.
  const loginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
  });
  if (loginRes.ok) {
    console.log(`Service-account user ${SEED_EMAIL} already exists in TLM — nothing to create.`);
    printServiceAccountEnv();
    process.exit(0);
  }

  // Doesn't exist (or the password given doesn't match) — need an existing TLM PLATFORM_ADMIN
  // credential to create it, e.g. the one TLM's own `npm run seed` produced.
  const bootstrapEmail = process.env.TLM_BOOTSTRAP_ADMIN_EMAIL;
  const bootstrapPassword = process.env.TLM_BOOTSTRAP_ADMIN_PASSWORD;
  if (!bootstrapEmail || !bootstrapPassword) {
    console.error(
      `Could not log in as ${SEED_EMAIL}, and no TLM_BOOTSTRAP_ADMIN_EMAIL/TLM_BOOTSTRAP_ADMIN_PASSWORD was given to create it.\n` +
        "Set those to an EXISTING PLATFORM_ADMIN's credentials in TLM (e.g. the admin TLM's own `npm run seed` created), " +
        `or create the service-account user manually via POST ${base}/users with role PLATFORM_ADMIN.`
    );
    process.exit(1);
  }

  const adminLoginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword }),
  });
  if (!adminLoginRes.ok) {
    console.error(`Could not log into TLM as ${bootstrapEmail}: ${adminLoginRes.status} ${await adminLoginRes.text()}`);
    process.exit(1);
  }
  const { token: adminToken } = (await adminLoginRes.json()) as { token: string };

  const createRes = await fetch(`${base}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD, role: "PLATFORM_ADMIN" }),
  });
  if (!createRes.ok) {
    console.error(`Could not create service-account user in TLM: ${createRes.status} ${await createRes.text()}`);
    process.exit(1);
  }
  console.log(`Created service-account user ${SEED_EMAIL} in TLM (role PLATFORM_ADMIN).`);
  printServiceAccountEnv();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
