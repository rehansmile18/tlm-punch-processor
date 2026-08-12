import { installMockRuleRepoFetch } from "./mockRuleRepo";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.RULE_REPO_SERVICE_ACCOUNT_EMAIL = "svc-punch-processor@internal";
process.env.RULE_REPO_SERVICE_ACCOUNT_PASSWORD = "test-service-password";

installMockRuleRepoFetch();
