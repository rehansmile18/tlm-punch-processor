import { describe, it, expect } from "vitest";
import { processorRegistry } from "../../src/engine/registry";
import { POLICY_TYPES } from "../../src/types/domain";

describe("processorRegistry", () => {
  it.each(POLICY_TYPES)("has a processor function registered for %s", (policyType) => {
    expect(processorRegistry[policyType]).toBeDefined();
    expect(typeof processorRegistry[policyType]).toBe("function");
  });

  it("registers exactly the 10 known PolicyType keys, no more, no fewer", () => {
    expect(Object.keys(processorRegistry).sort()).toEqual([...POLICY_TYPES].sort());
  });
});
