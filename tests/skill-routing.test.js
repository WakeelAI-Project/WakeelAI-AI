import { jest } from "@jest/globals";
import * as skillRegistry from "../src/skills/registry.js";
import * as toolRegistry from "../src/tools/registry.js";

// FIX-22: proves the real wiring in dependency-boundaries.js actually registers all 4
// production skills under the exact capability names the orchestrator's intent
// classification depends on (see normalizeIntent's deterministic capability
// injection in orchestrator.service.js) - not a hand-built test double.
// Importing dependency-boundaries.js runs its module-level self-registration.
await import("../src/orchestrator/dependency-boundaries.js");

describe("Skill routing - real registry wiring (FIX-22)", () => {
  const expectedSkills = [
    "calculation",
    "document_generation",
    "labor_law",
    "company_policy",
  ];

  it.each(expectedSkills)("registers the %s skill under its exact capability name", (name) => {
    expect(skillRegistry.has(name)).toBe(true);
    const skill = skillRegistry.get(name);
    expect(skill.name).toBe(name);
    expect(typeof skill.execute).toBe("function");
  });

  it("registers exactly the 4 skills the classification prompt promises, no more, no fewer", () => {
    const registeredNames = skillRegistry.list().map((entry) => entry.name);
    expect(new Set(registeredNames)).toEqual(new Set(expectedSkills));
  });

  const expectedTools = ["create_leave_draft", "submit_leave_draft", "cancel_leave_draft"];

  it.each(expectedTools)("registers the %s tool under its exact capability name", (name) => {
    expect(toolRegistry.has(name)).toBe(true);
    const tool = toolRegistry.get(name);
    expect(tool.name).toBe(name);
    expect(typeof tool.execute).toBe("function");
  });

  it("resolving a classified intent's capability name through executeCapabilitiesBoundary picks the exact matching skill, not another one", async () => {
    const { executeCapabilitiesBoundary } = await import("../src/orchestrator/dependency-boundaries.js");
    const calculationSkill = skillRegistry.get("calculation");
    const executeSpy = jest.spyOn(calculationSkill, "execute").mockResolvedValue({ success: true, data: {}, message: "ok", sources: [] });

    const ctx = { message: "calc", userContext: { role: "Employee" }, gatheredData: {} };
    const results = await executeCapabilitiesBoundary(["calculation"], ctx);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(results[0].capability).toBe("calculation");
    expect(results[0].status).toBe("success");

    executeSpy.mockRestore();
  });
});
