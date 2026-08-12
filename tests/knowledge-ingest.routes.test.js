import { jest } from "@jest/globals";

const mockIngestKnowledgeDocument = jest.fn();

jest.unstable_mockModule("../src/rag/ingestion/knowledge-ingestion.service.js", () => ({
  ingestKnowledgeDocument: mockIngestKnowledgeDocument,
}));

jest.unstable_mockModule("../src/orchestrator/orchestrator.service.js", () => ({
  handleChat: jest.fn(),
}));

const request = (await import("supertest")).default;
const app = (await import("../src/app.js")).default;

describe("POST /api/knowledge/ingest", () => {
  const validPayload = {
    companyId: "company-uuid",
    sourceType: "labor-law",
    documentId: "document-uuid",
    title: "Egyptian Labor Law",
    content: "Document text for ingestion.",
  };

  const validHeaders = {
    "X-Internal-API-Key": "your_internal_api_key_here",
    "X-User-Id": "user-456",
    "X-Company-Id": "company-789",
    "X-Role": "Company_Owner",
  };

  beforeAll(() => {
    process.env.WAKEEL_INTERNAL_API_KEY = "your_internal_api_key_here";
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIngestKnowledgeDocument.mockResolvedValue({
      success: true,
      documentId: "document-uuid",
      chunksCreated: 2,
    });
  });

  it("rejects a request missing the internal API key", async () => {
    const response = await request(app)
      .post("/api/knowledge/ingest")
      .send(validPayload);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED_SERVICE");
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("rejects a request missing identity headers", async () => {
    const response = await request(app)
      .post("/api/knowledge/ingest")
      .set("X-Internal-API-Key", "your_internal_api_key_here")
      .send(validPayload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("MISSING_IDENTITY_HEADERS");
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("accepts a valid labor-law ingestion request", async () => {
    const response = await request(app)
      .post("/api/knowledge/ingest")
      .set(validHeaders)
      .send(validPayload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      documentId: "document-uuid",
      chunksCreated: 2,
    });
    expect(mockIngestKnowledgeDocument).toHaveBeenCalledWith(validPayload);
  });

  it("accepts a valid company-policy ingestion request", async () => {
    const payload = {
      ...validPayload,
      sourceType: "company-policy",
      title: "Company Leave Policy",
    };

    const response = await request(app)
      .post("/api/knowledge/ingest")
      .set(validHeaders)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockIngestKnowledgeDocument).toHaveBeenCalledWith(payload);
  });

  it("rejects an invalid sourceType", async () => {
    const response = await request(app)
      .post("/api/knowledge/ingest")
      .set(validHeaders)
      .send({ ...validPayload, sourceType: "unknown" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("rejects missing required fields", async () => {
    const { documentId, ...payload } = validPayload;

    const response = await request(app)
      .post("/api/knowledge/ingest")
      .set(validHeaders)
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("rejects empty content", async () => {
    const response = await request(app)
      .post("/api/knowledge/ingest")
      .set(validHeaders)
      .send({ ...validPayload, content: "   " });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(mockIngestKnowledgeDocument).not.toHaveBeenCalled();
  });
});

