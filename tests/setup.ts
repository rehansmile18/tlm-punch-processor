import { installMockRuleRepoFetch } from "./mockRuleRepo";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.RULE_REPO_SERVICE_JWT = "test-service-jwt";
process.env.PUNCH_INGEST_API_KEY = "test-ingest-key";

installMockRuleRepoFetch();
