import { jest } from "@jest/globals";
const mockInvoke = jest.fn();
jest.unstable_mockModule("../src/llm/iti-adapter.js", () => {
  return {
    ITILanguageModel: jest.fn().mockImplementation(() => {
      return {
        invoke: mockInvoke
      };
    })
  };
});

// Mock the knowledge retrieval service
const retrieveKnowledgeSpy = jest.fn();
jest.unstable_mockModule("../src/rag/retrieval/knowledge-retrieval.service.js", () => {
  return {
    retrieveKnowledge: retrieveKnowledgeSpy
  };
});

const { default: companyPolicySkill } = await import("../src/skills/company-policy/company-policy.skill.js");

describe("CompanyPolicySkill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockContext = {
    userId: "u123",
    companyId: "c123",
    role: "Employee",
    conversationId: "conv1"
  };

  it("should retrieve company-policy knowledge scoped by companyId and return LLM answer", async () => {
    const mockChunks = [
      { title: "Remote Work", content: "Policy for remote work." }
    ];
    const mockSources = [
      { id: "doc2:0", title: "Remote Work", type: "company-policy", metadata: { similarityScore: 0.95 } }
    ];

    retrieveKnowledgeSpy.mockResolvedValueOnce({
      chunks: mockChunks,
      sources: mockSources
    });

    mockInvoke.mockResolvedValueOnce({ content: "Company allows remote work." });

    const result = await companyPolicySkill.execute("What is remote work policy?", mockContext);

    expect(retrieveKnowledgeSpy).toHaveBeenCalledWith({
      query: "What is remote work policy?",
      context: {
        knowledgeType: "company-policy",
        companyId: "c123", // Verifies strict tenant isolation
        topK: 3,
      }
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toContain("Policy for remote work.");
    
    expect(result.success).toBe(true);
    expect(result.data.answer).toBe("Company allows remote work.");
    expect(result.sources).toEqual(mockSources);
  });

  it("should return a safe fallback if no chunks are retrieved", async () => {
    retrieveKnowledgeSpy.mockResolvedValueOnce({
      chunks: [],
      sources: []
    });

    const result = await companyPolicySkill.execute("What is remote work policy?", mockContext);

    expect(retrieveKnowledgeSpy).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled(); // LLM is bypassed

    expect(result.success).toBe(true);
    expect(result.data.answer).toContain("No relevant company-specific policy");
    expect(result.sources).toEqual([]);
  });

  it("should fail immediately if companyId is missing in context", async () => {
    const badContext = { userId: "u123" }; // Missing companyId

    const result = await companyPolicySkill.execute("What is remote work policy?", badContext);

    expect(retrieveKnowledgeSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain("error occurred");
  });

  it("should handle retrieval failures gracefully", async () => {
    retrieveKnowledgeSpy.mockRejectedValueOnce(new Error("Retrieval failed"));

    const result = await companyPolicySkill.execute("What is remote work policy?", mockContext);

    expect(result.success).toBe(false);
    expect(result.message).toContain("error occurred");
  });
});
