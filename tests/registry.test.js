import { jest } from "@jest/globals";
import { z } from "zod";
import * as skillRegistry from "../src/skills/registry.js";
import * as toolRegistry from "../src/tools/registry.js";
import { AIContextSchema, SkillResultSchema, ChatResponseSchema } from "../src/contracts/index.js";

describe("Registry & Contracts (Task 3.2.2)", () => {
  beforeEach(() => {
    skillRegistry.clear();
    toolRegistry.clear();
  });

  const validSkill = {
    name: "test_skill",
    description: "A test skill",
    inputSchema: z.object({ arg: z.string() }),
    execute: async () => ({ success: true })
  };

  const validTool = {
    name: "test_tool",
    description: "A test tool",
    inputSchema: z.object({ arg: z.string() }),
    execute: async () => ({ success: true })
  };

  describe("Skill Registry", () => {
    it("should register a valid skill", () => {
      expect(() => skillRegistry.register(validSkill)).not.toThrow();
      expect(skillRegistry.has("test_skill")).toBe(true);
    });

    it("should retrieve a registered skill", () => {
      skillRegistry.register(validSkill);
      const skill = skillRegistry.get("test_skill");
      expect(skill).toBe(validSkill);
    });

    it("has() returns true for registered and false for unknown skill", () => {
      skillRegistry.register(validSkill);
      expect(skillRegistry.has("test_skill")).toBe(true);
      expect(skillRegistry.has("unknown_skill")).toBe(false);
    });

    it("list() returns registered skills", () => {
      skillRegistry.register(validSkill);
      const list = skillRegistry.list();
      expect(list.length).toBe(1);
      expect(list[0]).toEqual({ name: "test_skill", description: "A test skill" });
    });

    it("should reject duplicate registration", () => {
      skillRegistry.register(validSkill);
      expect(() => skillRegistry.register(validSkill)).toThrow(/already registered/i);
    });

    it("should reject invalid skill definition", () => {
      const invalidSkill = { name: "" }; // missing description, execute, etc.
      expect(() => skillRegistry.register(invalidSkill)).toThrow(/Invalid skill definition/i);
    });
  });

  describe("Tool Registry", () => {
    it("should register a valid tool", () => {
      expect(() => toolRegistry.register(validTool)).not.toThrow();
      expect(toolRegistry.has("test_tool")).toBe(true);
    });

    it("should retrieve a registered tool", () => {
      toolRegistry.register(validTool);
      const tool = toolRegistry.get("test_tool");
      expect(tool).toBe(validTool);
    });

    it("has() works", () => {
      toolRegistry.register(validTool);
      expect(toolRegistry.has("test_tool")).toBe(true);
      expect(toolRegistry.has("unknown_tool")).toBe(false);
    });

    it("list() works", () => {
      toolRegistry.register(validTool);
      const list = toolRegistry.list();
      expect(list.length).toBe(1);
      expect(list[0]).toEqual({ name: "test_tool", description: "A test tool" });
    });

    it("should reject duplicate registration", () => {
      toolRegistry.register(validTool);
      expect(() => toolRegistry.register(validTool)).toThrow(/already registered/i);
    });

    it("should reject invalid tool definition", () => {
      const invalidTool = { description: "Missing name" };
      expect(() => toolRegistry.register(invalidTool)).toThrow(/Invalid tool definition/i);
    });
  });

  describe("Contracts", () => {
    it("Valid AI context passes", () => {
      const context = { userId: "u1", companyId: "c1", role: "employee", conversationId: "conv1" };
      expect(AIContextSchema.safeParse(context).success).toBe(true);
    });

    it("Invalid AI context fails", () => {
      const context = { userId: "u1", companyId: "c1" }; // missing role and convId
      expect(AIContextSchema.safeParse(context).success).toBe(false);
    });

    it("Valid SkillResult passes", () => {
      const result = { success: true, data: { foo: "bar" }, message: "OK" };
      expect(SkillResultSchema.safeParse(result).success).toBe(true);
      
      const nullResult = { success: false, data: null, message: null };
      expect(SkillResultSchema.safeParse(nullResult).success).toBe(true);
    });

    it("Invalid SkillResult fails", () => {
      const result = { data: "test" }; // missing success
      expect(SkillResultSchema.safeParse(result).success).toBe(false);
    });

    it("Valid ChatResponse passes", () => {
      const response = {
        conversationId: "c1",
        message: "Hello",
        type: "text",
        sources: [],
        actions: []
      };
      expect(ChatResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe("Orchestrator Integration", () => {
    let executeCapabilitiesBoundary;
    
    beforeAll(async () => {
      const boundary = await import("../src/orchestrator/dependency-boundaries.js");
      executeCapabilitiesBoundary = boundary.executeCapabilitiesBoundary;
    });

    it("Orchestrator can resolve a registered capability through the registry", async () => {
      const executeMock = jest.fn().mockResolvedValue("mocked result");
      const testSkill = {
        name: "test_capability",
        description: "A test capability",
        inputSchema: z.object({}),
        execute: executeMock
      };
      skillRegistry.register(testSkill);

      const ctx = { message: "test", userContext: {} };
      const results = await executeCapabilitiesBoundary(["test_capability"], ctx);

      expect(results.length).toBe(1);
      expect(results[0].status).toBe("success");
      expect(results[0].data).toBe("mocked result");
      expect(executeMock).toHaveBeenCalledWith("test", {}, {}, undefined);
    });

    it("Unknown/unregistered capability is handled cleanly", async () => {
      const ctx = { message: "test", userContext: {} };
      const results = await executeCapabilitiesBoundary(["unknown_capability"], ctx);

      expect(results.length).toBe(1);
      expect(results[0].status).toBe("error");
      expect(results[0].message).toMatch(/not found/i);
    });

    it("No fake business capability result is generated", async () => {
      const ctx = { message: "test", userContext: {} };
      const results = await executeCapabilitiesBoundary(["unknown_capability"], ctx);
      
      expect(results[0].data).toBeUndefined(); // Ensure data is not a fake "stub executed" string
    });
  });
});
