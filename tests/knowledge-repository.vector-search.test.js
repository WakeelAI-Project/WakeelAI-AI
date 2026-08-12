import { jest } from "@jest/globals";

const mockAggregate = jest.fn();

jest.unstable_mockModule("../src/data-access/knowledge-chunk.model.js", () => ({
  KnowledgeChunk: {
    aggregate: mockAggregate,
  },
}));

const { searchKnowledgeChunksByVector } = await import("../src/data-access/knowledge-repository.js");

describe("searchKnowledgeChunksByVector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAggregate.mockResolvedValue([]);
  });

  it("executes a MongoDB Atlas Vector Search pipeline with score projection", async () => {
    const queryVector = Array.from({ length: 1024 }, () => 0.1);
    const filter = {
      $and: [
        { sourceType: "labor-law" },
        { scope: "global" },
      ],
    };

    await searchKnowledgeChunksByVector({
      indexName: "test_vector_index",
      vectorPath: "embedding",
      queryVector,
      filter,
      limit: 5,
      numCandidates: 100,
    });

    expect(mockAggregate).toHaveBeenCalledWith([
      {
        $vectorSearch: {
          index: "test_vector_index",
          path: "embedding",
          queryVector,
          numCandidates: 100,
          limit: 5,
          filter,
        },
      },
      {
        $project: {
          _id: 0,
          documentId: 1,
          companyId: 1,
          sourceType: 1,
          scope: 1,
          title: 1,
          content: 1,
          chunkIndex: 1,
          knowledgeVersion: 1,
          sourcePath: 1,
          metadata: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ]);
  });
});

