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

const { default: laborLawSkill } = await import("../src/skills/labor-law/labor-law.skill.js");

describe("LaborLawSkill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockContext = {
    userId: "u123",
    companyId: "c123",
    role: "Employee",
    conversationId: "conv1"
  };

  it("should retrieve labor-law knowledge and return LLM answer with sources", async () => {
    const mockChunks = [
      { title: "Article 1", content: "Labor law article 1." }
    ];
    const mockSources = [
      { id: "doc1:0", title: "Article 1", type: "labor-law", metadata: { similarityScore: 0.9 } }
    ];

    retrieveKnowledgeSpy.mockResolvedValueOnce({
      chunks: mockChunks,
      sources: mockSources
    });

    mockInvoke.mockResolvedValueOnce({ content: "Here is the legal answer." });

    const result = await laborLawSkill.execute("What is the law?", mockContext);

    expect(retrieveKnowledgeSpy).toHaveBeenCalledWith({
      query: "What is the law?",
      context: {
        knowledgeType: "labor-law",
        topK: 3,
      }
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toContain("Article 1");
    
    expect(result.success).toBe(true);
    expect(result.data.answer).toBe("Here is the legal answer.");
    expect(result.sources).toEqual(mockSources);
  });

  it("should return a safe fallback if no chunks are retrieved", async () => {
    retrieveKnowledgeSpy.mockResolvedValueOnce({
      chunks: [],
      sources: []
    });

    const result = await laborLawSkill.execute("What is the law?", mockContext);

    expect(retrieveKnowledgeSpy).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled(); // LLM is bypassed

    expect(result.success).toBe(true);
    expect(result.data.answer).toContain("No relevant legal support was found");
    expect(result.sources).toEqual([]);
  });

  it("should handle retrieval failures gracefully", async () => {
    retrieveKnowledgeSpy.mockRejectedValueOnce(new Error("Retrieval failed"));

    const result = await laborLawSkill.execute("What is the law?", mockContext);

    expect(result.success).toBe(false);
    expect(result.message).toContain("error occurred");
    expect(result.sources).toEqual([]);
  });

  it("should handle LLM failures gracefully", async () => {
    retrieveKnowledgeSpy.mockResolvedValueOnce({
      chunks: [{ title: "Art 1", content: "..." }],
      sources: [{ id: "1" }]
    });

    mockInvoke.mockRejectedValueOnce(new Error("LLM failed"));

    const result = await laborLawSkill.execute("What is the law?", mockContext);

    expect(result.success).toBe(false);
    expect(result.message).toContain("error occurred");
  });
});
