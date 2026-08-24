import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  buildMissingFields,
  extractFieldValuesFromMessage,
  extractPlaceholders,
  generateDocument,
  parseTemplatePlaceholders,
  renderTemplate,
  resolveDocumentTypeFromMessages,
} from "../src/services/document-generation.service.js";

describe("DocumentGenerationService", () => {
  const aiContext = {
    userId: "hr-1",
    companyId: "company-1",
    role: "HR_Manager",
    conversationId: "conv-1",
    targetEmployeeId: "emp-1",
  };

  const baseDate = new Date("2026-08-12T00:00:00Z");

  const template = {
    template_id: "tpl-1",
    document_type: "Contract",
    name: "Default Employment Contract",
    content_template: [
      "<h1>Employment Contract</h1>",
      "<p>Company: {{company_name}}</p>",
      "<p>Employee: {{employee_name}}</p>",
      "<p>ID: {{employee_id}}</p>",
      "<p>Position: {{job_title}}</p>",
      "<p>Salary: {{salary}}</p>",
      "<p>Start: {{start_date}}</p>",
      "<p>Hours: {{working_hours}}</p>",
    ].join("\n"),
  };

  const templateWithoutEmployeeId = {
    ...template,
    content_template: [
      "<h1>Employment Contract</h1>",
      "<p>Company: {{company_name}}</p>",
      "<p>Employee: {{employee_name}}</p>",
      "<p>Position: {{job_title}}</p>",
      "<p>Salary: {{salary}}</p>",
      "<p>Start: {{start_date}}</p>",
      "<p>Hours: {{working_hours}}</p>",
    ].join("\n"),
  };

  const companyContext = {
    companyId: "company-1",
    companyName: "Wakeel AI",  // ← camelCase to match company-context.service.js
    industry: "HR Tech",
    address: "Cairo",
    phoneNumber: "01000000000",  // ← camelCase
    email: "hr@wakeel.test",
    logoUrl: null,  // ← camelCase
    workingHours: "9 to 5",  // ← camelCase
    registeredAt: "2024-01-01",  // ← camelCase
    policyAvailable: false,
  };

  const saveResponse = {
    success: true,
    document_id: "doc-1",
    document_type: "Contract",
    status: "draft",
    created_at: "2026-08-12T10:30:00Z",
  };

  let getActiveTemplateFn;
  let saveDocumentFn;
  let getCompanyContextFn;
  let getEmployeeContextFn;
  let retrieveKnowledgeFn;
  let getConversationHistoryFn;
  let generateLegalClauseFn;

  beforeEach(() => {
    getActiveTemplateFn = jest.fn().mockResolvedValue(template);
    saveDocumentFn = jest.fn().mockResolvedValue(saveResponse);
    getCompanyContextFn = jest.fn().mockResolvedValue(companyContext);
    getEmployeeContextFn = jest.fn().mockRejectedValue(new Error("Backend error 404 from /api/ai/employee-context"));
    retrieveKnowledgeFn = jest
      .fn()
      .mockResolvedValue({ chunks: [], sources: [] });
    getConversationHistoryFn = jest.fn().mockResolvedValue({ messages: [] });
    generateLegalClauseFn = jest.fn().mockResolvedValue({
      support: "supported",
      clause: "Grounded generated clause.",
      source_ids: ["law-1:0"],
    });
  });

  const deps = () => ({
    getActiveTemplateFn,
    saveDocumentFn,
    getCompanyContextFn,
    getEmployeeContextFn,
    retrieveKnowledgeFn,
    getConversationHistoryFn,
    generateLegalClauseFn,
    baseDate,
  });

  describe("template processing", () => {
    it("extracts valid placeholders once in template order", () => {
      expect(
        extractPlaceholders(
          "<p>{{employee_name}}</p><p>{{ employee_name }}</p><p>{{salary}}</p>",
        ),
      ).toEqual(["employee_name", "salary"]);
    });

    it("classifies input and AI-generated placeholders", () => {
      expect(
        parseTemplatePlaceholders(
          [
            "{{employee_name}}",
            "{{legal_clause:probation}}",
            "{{policy_clause:working_hours}}",
            "{{legal_policy_clause:annual_leave}}",
          ].join("\n"),
        ),
      ).toEqual([
        { name: "employee_name", kind: "input" },
        expect.objectContaining({
          name: "legal_clause:probation",
          kind: "ai_generated",
          clause_key: "probation",
          source_types: ["labor-law"],
          source_type: "labor_law",
        }),
        expect.objectContaining({
          name: "policy_clause:working_hours",
          kind: "ai_generated",
          clause_key: "working_hours",
          source_types: ["company-policy"],
          source_type: "company_policy",
        }),
        expect.objectContaining({
          name: "legal_policy_clause:annual_leave",
          kind: "ai_generated",
          clause_key: "annual_leave",
          source_types: ["labor-law", "company-policy"],
          source_type: "labor_law_and_company_policy",
        }),
      ]);
    });

    it("returns no placeholders for static templates", () => {
      expect(extractPlaceholders("<p>Static HTML</p>")).toEqual([]);
    });

    it("rejects malformed placeholder syntax", () => {
      expect(() => extractPlaceholders("<p>{{employee_name</p>")).toThrow(
        "Malformed placeholder syntax in active template.",
      );
    });

    it("renders escaped values and rejects unresolved placeholders", () => {
      expect(
        renderTemplate("<p>{{employee_name}}</p>", {
          employee_name: "Ahmed <Ali>",
        }),
      ).toBe("<p>Ahmed &lt;Ali&gt;</p>");

      expect(() => renderTemplate("<p>{{employee_name}}</p>", {})).toThrow(
        "Generated document still contains unresolved placeholders.",
      );
    });
  });

  describe("field handling", () => {
    it("extracts common employment-contract fields from natural language", () => {
      const values = extractFieldValuesFromMessage(
        "Create an employment contract for Ahmed as Backend Developer with salary 20,000 starting September 1. Employee ID is emp-123.",
        ["employee_name", "employee_id", "job_title", "salary", "start_date"],
        { baseDate },
      );

      expect(values).toEqual({
        employee_name: "Ahmed",
        employee_id: "emp-123",
        job_title: "Backend Developer",
        salary: "20000",
        start_date: "2026-09-01",
      });
    });

    it("creates structured missing fields using the finalized schema", () => {
      expect(
        buildMissingFields(["employee_id", "salary"], { salary: "20000" }),
      ).toEqual([
        {
          field_name: "employee_id",
          input_type: "text",
          label: "Employee ID",
          options: [],
        },
      ]);
    });

    it("does not treat a non-terminating sentence as a valid employee name", async () => {
      const result = await generateDocument(
        {
          message:
            "generate a document for employee contract using saved templates",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("missing_fields");
      expect(result.missing_fields.map((field) => field.field_name)).toContain(
        "employee_name",
      );
    });

    it("resolves employment-contract language to the existing Contract document type", () => {
      expect(
        resolveDocumentTypeFromMessages([
          { role: "user", content: "Create an employment contract" },
        ]),
      ).toEqual({ documentType: "Contract" });
    });
  });

  describe("generation flow", () => {
    it("renders a static-only template without company context, RAG, or LLM generation", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: "<h1>Employment Contract</h1><p>Static terms.</p>",
      });

      const result = await generateDocument(
        {
          message: "Create an employment contract.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(getCompanyContextFn).not.toHaveBeenCalled();
      expect(retrieveKnowledgeFn).not.toHaveBeenCalled();
      expect(generateLegalClauseFn).not.toHaveBeenCalled();
      const payload = saveDocumentFn.mock.calls[0][1];
      expect(payload).toEqual(
        expect.objectContaining({
          title: "Employment Contract Draft",
          content_html: "<h1>Employment Contract</h1><p>Static terms.</p>",
          employee_id: "emp-1",
        }),
      );
    });

    it("succeeds for a new-employee contract template and attaches authoritative targetEmployeeId", async () => {
      getActiveTemplateFn.mockResolvedValue(templateWithoutEmployeeId);

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed Mohamed as Software Engineer with salary 25000 starting September 1.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(result.result_card).toEqual({
        type: "document_draft",
        doc_id: "doc-1",
        doc_type: "Contract",
        employee_id: "emp-1",
        employee_name: "Ahmed Mohamed",
      });

      const payload = saveDocumentFn.mock.calls[0][1];
      expect(payload).toHaveProperty("employee_id", "emp-1");
      expect(payload.content_html).toContain("Employee: Ahmed Mohamed");
      expect(payload.content_html).toContain("Position: Software Engineer");
      expect(payload.content_html).toContain("Salary: 25000");
      expect(payload.content_html).toContain("Start: 2026-09-01");
    });

    it("does not ask for employee_id when the active template does not contain it", async () => {
      getActiveTemplateFn.mockResolvedValue(templateWithoutEmployeeId);

      const result = await generateDocument(
        {
          message: "Create an employment contract for Ahmed.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("missing_fields");
      expect(result.missing_fields.map((field) => field.field_name)).toEqual([
        "job_title",
        "salary",
        "start_date",
      ]);
    });

    it("forwards authoritative targetEmployeeId from context even if template does not have employee_id placeholder", async () => {
      getActiveTemplateFn.mockResolvedValue(templateWithoutEmployeeId);

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed Mohamed as Software Engineer with salary 25000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      const payload = saveDocumentFn.mock.calls[0][1];
      expect(payload).toHaveProperty("employee_id", "emp-1");
      expect(result.result_card).toHaveProperty("employee_id", "emp-1");
    });

    it("retrieves the active template, renders HTML, saves the draft, and returns document_draft result card", async () => {
      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123, working hours are 10 to 6.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("saved");
      expect(getConversationHistoryFn).toHaveBeenCalledWith(
        "conv-1",
        aiContext,
        1,
        50,
      );
      expect(getActiveTemplateFn).toHaveBeenCalledWith(aiContext, "Contract");
      expect(getCompanyContextFn).toHaveBeenCalledWith(aiContext);
      expect(saveDocumentFn).toHaveBeenCalledWith(
        aiContext,
        expect.objectContaining({
          document_type: "Contract",
          title: "Employment Contract - Ahmed",
          employee_id: "emp-1",
          template_id: "tpl-1",
        }),
      );

      const payload = saveDocumentFn.mock.calls[0][1];
      expect(payload.content_html).toContain("Company: Wakeel AI");
      expect(payload.content_html).toContain("Employee: Ahmed");
      expect(payload.content_html).toContain("Position: Backend Developer");
      expect(payload.content_html).toContain("Salary: 20000");
      expect(payload.content_html).toContain("Start: 2026-09-01");
      expect(payload.content_html).toContain("Hours: 10 to 6");
      expect(payload.content_html).not.toMatch(/\{\{/);
      expect(payload.metadata.filled_fields.company_name).toBe("Wakeel AI");

      expect(result.result_card).toEqual({
        type: "document_draft",
        doc_id: "doc-1",
        doc_type: "Contract",
        employee_id: "emp-1",
        employee_name: "Ahmed",
      });
    });

    it("returns missing_fields and does not save when required values are absent", async () => {
      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer starting 2026-09-01.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("missing_fields");
      expect(result.missing_fields.map((field) => field.field_name)).toEqual([
        "salary",
      ]);
      expect(saveDocumentFn).not.toHaveBeenCalled();
    });

    it("accumulates values across conversation turns without forgetting prior fields", async () => {
      const result = await generateDocument(
        {
          message:
            "Employee ID is emp-123, start date is 2026-09-01, working hours are 9 to 5.",
          aiContext,
          conversationMessages: [
            {
              role: "user",
              content:
                "Create an employment contract for Ahmed as Backend Developer with salary 20000.",
            },
          ],
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(saveDocumentFn).toHaveBeenCalledTimes(1);

      const payload = saveDocumentFn.mock.calls[0][1];
      expect(payload.content_html).toContain("Employee: Ahmed");
      expect(payload.content_html).toContain("Position: Backend Developer");
      expect(payload.content_html).toContain("Salary: 20000");
      expect(payload.employee_id).toBe("emp-1");
    });

    it("treats unavailable company context values as missing instead of inventing them", async () => {
      getCompanyContextFn.mockResolvedValue({ ...companyContext, companyName: null });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.status).toBe("missing_fields");
      expect(result.missing_fields.map((field) => field.field_name)).toContain(
        "company_name",
      );
      expect(saveDocumentFn).not.toHaveBeenCalled();
    });

    it("retrieves labor-law knowledge and generates a grounded legal clause for an AI placeholder", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: `${template.content_template}\n<p>Legal: {{legal_clause:termination}}</p>`,
      });
      retrieveKnowledgeFn.mockResolvedValue({
        chunks: [
          {
            documentId: "law-1",
            title: "Labor Law",
            content: "Grounded legal clause from retrieved labor law.",
            knowledgeType: "labor-law",
            scope: "global",
            chunkIndex: 0,
            similarityScore: 0.91,
          },
        ],
        sources: [
          {
            id: "law-1:0",
            title: "Labor Law",
            type: "labor-law",
            content: "Grounded legal clause from retrieved labor law.",
            metadata: { knowledgeType: "labor-law", scope: "global" },
          },
        ],
      });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(retrieveKnowledgeFn).toHaveBeenCalledWith({
        query:
          "Egyptian labor law Contract termination Backend Developer 9 to 5 HR Tech",
        context: {
          knowledgeType: "labor-law",
          companyId: undefined,
          topK: 3,
        },
      });
      expect(generateLegalClauseFn).toHaveBeenCalledWith(
        expect.objectContaining({
          clause: expect.objectContaining({
            name: "legal_clause:termination",
            kind: "ai_generated",
            source_types: ["labor-law"],
            clause_key: "termination",
          }),
          documentType: "Contract",
          sources: expect.arrayContaining([
            expect.objectContaining({
              id: "law-1:0",
              metadata: expect.objectContaining({
                clause_id: "legal_clause:termination",
                clause_source_type: "labor-law",
              }),
            }),
          ]),
        }),
      );
      expect(saveDocumentFn.mock.calls[0][1].content_html).toContain(
        "Grounded generated clause.",
      );
      expect(result.sources).toHaveLength(1);
      expect(
        saveDocumentFn.mock.calls[0][1].metadata.generated_clauses,
      ).toEqual([
        expect.objectContaining({
          clause_id: "legal_clause:termination",
          source_ids: ["law-1:0"],
        }),
      ]);
    });

    it("generates RAG-grounded legal clauses without requiring employee_id", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...templateWithoutEmployeeId,
        content_template: `${templateWithoutEmployeeId.content_template}\n<p>Legal: {{legal_clause:termination}}</p>`,
      });
      retrieveKnowledgeFn.mockResolvedValue({
        chunks: [
          {
            documentId: "law-1",
            title: "Labor Law",
            content: "Grounded legal clause support.",
            knowledgeType: "labor-law",
            scope: "global",
            chunkIndex: 0,
            similarityScore: 0.91,
          },
        ],
        sources: [
          {
            id: "law-1:0",
            title: "Labor Law",
            type: "labor-law",
            content: "Grounded legal clause support.",
            metadata: { knowledgeType: "labor-law", scope: "global" },
          },
        ],
      });
      generateLegalClauseFn.mockResolvedValue({
        support: "supported",
        clause: "Grounded generated termination clause.",
        source_ids: ["law-1:0"],
      });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed Mohamed as Software Engineer with salary 25000 starting 2026-09-01.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(generateLegalClauseFn).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeContext: expect.objectContaining({
            employee_id: "emp-1",
          }),
        }),
      );

      const payload = saveDocumentFn.mock.calls[0][1];
      expect(payload).toHaveProperty("employee_id", "emp-1");
      expect(payload.content_html).toContain(
        "Grounded generated termination clause.",
      );
      expect(result.result_card).toHaveProperty("employee_id", "emp-1");
    });

    it("retrieves company-policy knowledge with tenant scope when the template requires policy content", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: `${template.content_template}\n<p>Policy: {{policy_clause:working_hours}}</p>`,
      });
      retrieveKnowledgeFn.mockResolvedValue({
        chunks: [
          {
            documentId: "policy-1",
            title: "Company Policy",
            content: "Grounded company policy clause.",
            knowledgeType: "company-policy",
            scope: "company",
            companyId: "company-1",
            chunkIndex: 0,
            similarityScore: 0.89,
          },
        ],
        sources: [
          {
            id: "policy-1:0",
            title: "Company Policy",
            type: "company-policy",
            content: "Grounded company policy clause.",
            metadata: {
              knowledgeType: "company-policy",
              scope: "company",
              companyId: "company-1",
            },
          },
        ],
      });
      generateLegalClauseFn.mockResolvedValue({
        support: "supported",
        clause: "Grounded company policy working-hours clause.",
        source_ids: ["policy-1:0"],
      });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(retrieveKnowledgeFn).toHaveBeenCalledWith({
        query:
          "company policy Contract working hours Backend Developer 9 to 5 HR Tech",
        context: {
          knowledgeType: "company-policy",
          companyId: "company-1",
          topK: 3,
        },
      });
      expect(generateLegalClauseFn).toHaveBeenCalledWith(
        expect.objectContaining({
          clause: expect.objectContaining({
            name: "policy_clause:working_hours",
            source_types: ["company-policy"],
          }),
        }),
      );
      expect(saveDocumentFn.mock.calls[0][1].content_html).toContain(
        "Grounded company policy working-hours clause.",
      );
    });

    it("processes multiple AI-generated clauses independently", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: [
          template.content_template,
          "<p>Probation: {{legal_clause:probation}}</p>",
          "<p>Termination: {{legal_clause:termination}}</p>",
          "<p>Hours Policy: {{policy_clause:working_hours}}</p>",
        ].join("\n"),
      });

      retrieveKnowledgeFn.mockImplementation(async ({ context }) => {
        if (context.knowledgeType === "company-policy") {
          return {
            chunks: [
              {
                documentId: "policy-1",
                title: "Working Hours Policy",
                content: "Company policy support for working hours.",
                knowledgeType: "company-policy",
                scope: "company",
                companyId: "company-1",
                chunkIndex: 0,
                similarityScore: 0.9,
              },
            ],
            sources: [
              {
                id: "policy-1:0",
                title: "Working Hours Policy",
                type: "company-policy",
                content: "Company policy support for working hours.",
                metadata: {
                  knowledgeType: "company-policy",
                  scope: "company",
                  companyId: "company-1",
                },
              },
            ],
          };
        }

        const callIndex = retrieveKnowledgeFn.mock.calls.length;
        return {
          chunks: [
            {
              documentId: "law-1",
              title: "Labor Law",
              content: `Labor-law support ${callIndex}.`,
              knowledgeType: "labor-law",
              scope: "global",
              chunkIndex: callIndex,
              similarityScore: 0.91,
            },
          ],
          sources: [
            {
              id: `law-1:${callIndex}`,
              title: "Labor Law",
              type: "labor-law",
              content: `Labor-law support ${callIndex}.`,
              metadata: { knowledgeType: "labor-law", scope: "global" },
            },
          ],
        };
      });

      generateLegalClauseFn.mockImplementation(async ({ clause, sources }) => ({
        support: "supported",
        clause: `Generated ${clause.clause_key} clause.`,
        source_ids: [sources[0].id],
      }));

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(retrieveKnowledgeFn).toHaveBeenCalledTimes(3);
      expect(generateLegalClauseFn).toHaveBeenCalledTimes(3);

      const html = saveDocumentFn.mock.calls[0][1].content_html;
      expect(html).toContain("Generated probation clause.");
      expect(html).toContain("Generated termination clause.");
      expect(html).toContain("Generated working_hours clause.");
      expect(
        saveDocumentFn.mock.calls[0][1].metadata.generated_clauses,
      ).toHaveLength(3);
    });

    it("retrieves both labor-law and company-policy sources for a mixed AI clause", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: `${template.content_template}\n<p>Leave: {{legal_policy_clause:annual_leave}}</p>`,
      });

      retrieveKnowledgeFn.mockImplementation(async ({ context }) => {
        if (context.knowledgeType === "labor-law") {
          return {
            chunks: [
              {
                documentId: "law-annual",
                title: "Labor Law Annual Leave",
                content: "Labor law support for annual leave.",
                knowledgeType: "labor-law",
                scope: "global",
                chunkIndex: 0,
                similarityScore: 0.91,
              },
            ],
            sources: [
              {
                id: "law-annual:0",
                title: "Labor Law Annual Leave",
                type: "labor-law",
                content: "Labor law support for annual leave.",
                metadata: { knowledgeType: "labor-law", scope: "global" },
              },
            ],
          };
        }

        return {
          chunks: [
            {
              documentId: "policy-annual",
              title: "Company Annual Leave Policy",
              content: "Company policy support for annual leave.",
              knowledgeType: "company-policy",
              scope: "company",
              companyId: "company-1",
              chunkIndex: 0,
              similarityScore: 0.88,
            },
          ],
          sources: [
            {
              id: "policy-annual:0",
              title: "Company Annual Leave Policy",
              type: "company-policy",
              content: "Company policy support for annual leave.",
              metadata: {
                knowledgeType: "company-policy",
                scope: "company",
                companyId: "company-1",
              },
            },
          ],
        };
      });
      generateLegalClauseFn.mockResolvedValue({
        support: "supported",
        clause: "Grounded annual leave clause from law and policy.",
        source_ids: ["law-annual:0", "policy-annual:0"],
      });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(retrieveKnowledgeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            knowledgeType: "labor-law",
            companyId: undefined,
          }),
        }),
      );
      expect(retrieveKnowledgeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            knowledgeType: "company-policy",
            companyId: "company-1",
          }),
        }),
      );
      expect(generateLegalClauseFn).toHaveBeenCalledWith(
        expect.objectContaining({
          clause: expect.objectContaining({
            source_types: ["labor-law", "company-policy"],
            source_type: "labor_law_and_company_policy",
          }),
          sources: expect.arrayContaining([
            expect.objectContaining({ id: "law-annual:0" }),
            expect.objectContaining({ id: "policy-annual:0" }),
          ]),
        }),
      );
      expect(result.sources.map((source) => source.id)).toEqual([
        "law-annual:0",
        "policy-annual:0",
      ]);
    });

    it("does not invent legal content when retrieval has no grounded chunks", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: `${template.content_template}\n<p>Legal: {{legal_clause:annual_leave}}</p>`,
      });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.status).toBe("error");
      expect(result.error.code).toBe("INSUFFICIENT_SOURCE_SUPPORT");
      expect(generateLegalClauseFn).not.toHaveBeenCalled();
      expect(saveDocumentFn).not.toHaveBeenCalled();
    });

    it("stops when the LLM reports insufficient source support", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: `${template.content_template}\n<p>Legal: {{legal_clause:annual_leave}}</p>`,
      });
      retrieveKnowledgeFn.mockResolvedValue({
        chunks: [
          {
            documentId: "law-1",
            title: "Labor Law",
            content:
              "General employment source without enough annual leave detail.",
            knowledgeType: "labor-law",
            scope: "global",
            chunkIndex: 0,
            similarityScore: 0.8,
          },
        ],
        sources: [
          {
            id: "law-1:0",
            title: "Labor Law",
            type: "labor-law",
            content:
              "General employment source without enough annual leave detail.",
            metadata: { knowledgeType: "labor-law", scope: "global" },
          },
        ],
      });
      generateLegalClauseFn.mockResolvedValue({
        support: "insufficient_source_support",
        clause: "",
        source_ids: [],
      });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("INSUFFICIENT_SOURCE_SUPPORT");
      expect(saveDocumentFn).not.toHaveBeenCalled();
    });

    it("fails validation when a generated clause contains unsupported placeholders", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: `${template.content_template}\n<p>Legal: {{legal_clause:probation}}</p>`,
      });
      retrieveKnowledgeFn.mockResolvedValue({
        chunks: [
          {
            documentId: "law-1",
            title: "Labor Law",
            content: "Grounded probation support.",
            knowledgeType: "labor-law",
            scope: "global",
            chunkIndex: 0,
            similarityScore: 0.91,
          },
        ],
        sources: [
          {
            id: "law-1:0",
            title: "Labor Law",
            type: "labor-law",
            content: "Grounded probation support.",
            metadata: { knowledgeType: "labor-law", scope: "global" },
          },
        ],
      });
      generateLegalClauseFn.mockResolvedValue({
        support: "supported",
        clause: "Probation applies to {{unknown_field}}.",
        source_ids: ["law-1:0"],
      });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("GENERATED_CLAUSE_VALIDATION_FAILED");
      expect(saveDocumentFn).not.toHaveBeenCalled();
    });

    it("rejects detectable unsupported numeric legal statements", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: `${template.content_template}\n<p>Leave: {{legal_clause:annual_leave}}</p>`,
      });
      retrieveKnowledgeFn.mockResolvedValue({
        chunks: [
          {
            documentId: "law-1",
            title: "Labor Law",
            content:
              "The source discusses annual leave but does not establish a 21 day entitlement.",
            knowledgeType: "labor-law",
            scope: "global",
            chunkIndex: 0,
            similarityScore: 0.91,
          },
        ],
        sources: [
          {
            id: "law-1:0",
            title: "Labor Law",
            type: "labor-law",
            content:
              "The source discusses annual leave but does not establish a day entitlement.",
            metadata: { knowledgeType: "labor-law", scope: "global" },
          },
        ],
      });
      generateLegalClauseFn.mockResolvedValue({
        support: "supported",
        clause: "The employee is entitled to 21 days of annual leave.",
        source_ids: ["law-1:0"],
      });

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("GENERATED_CLAUSE_UNSUPPORTED_CONTENT");
      expect(saveDocumentFn).not.toHaveBeenCalled();
    });

    it("handles unsupported document types before calling template retrieval", async () => {
      const result = await generateDocument(
        {
          message: "Create an NDA document for Ahmed.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("UNSUPPORTED_DOCUMENT_TYPE");
      expect(getActiveTemplateFn).not.toHaveBeenCalled();
    });

    it("handles template not found as a structured application error", async () => {
      getActiveTemplateFn.mockRejectedValue(
        new Error("Active template not found for documentType: Contract"),
      );

      const result = await generateDocument(
        {
          message: "Create an employment contract for Ahmed.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("TEMPLATE_NOT_FOUND");
    });

    it("rejects templates whose document type does not match the request", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        document_type: "Warning",
      });

      const result = await generateDocument(
        {
          message: "Create an employment contract for Ahmed.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("TEMPLATE_DOCUMENT_TYPE_MISMATCH");
    });

    it("rejects malformed active templates", async () => {
      getActiveTemplateFn.mockResolvedValue({
        ...template,
        content_template: "<p>{{employee_name</p>",
      });

      const result = await generateDocument(
        {
          message: "Create an employment contract for Ahmed.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("TEMPLATE_SCHEMA_INVALID");
      expect(saveDocumentFn).not.toHaveBeenCalled();
    });

    it("handles backend save failure without reporting a saved draft", async () => {
      saveDocumentFn.mockRejectedValue(new Error("Backend save failed"));

      const result = await generateDocument(
        {
          message:
            "Create an employment contract for Ahmed as Backend Developer with salary 20000 starting 2026-09-01. Employee ID is emp-123.",
          aiContext,
        },
        deps(),
      );

      expect(result.success).toBe(false);
      expect(result.error.code).toBe("DOCUMENT_SAVE_FAILED");
      expect(result.result_card).toBeUndefined();
    });

    it("REGRESSION: merges field_values from aiContext with conversation history values", async () => {
      // This test prevents the infinite loop bug where submitted field_values
      // weren't properly merged, causing the AI to repeatedly ask for the same fields.
      
      getActiveTemplateFn.mockResolvedValue(templateWithoutEmployeeId);

      const conversationMessages = [
        {
          role: "user",
          content: "Create an employment contract using employee contract template",
        },
        {
          role: "assistant",
          content: "I can create that draft, but I need a few required fields first.",
        },
      ];

      // Simulate follow-up request with field_values from the "Additional details needed" form
      const contextWithFieldValues = {
        ...aiContext,
        field_values: {
          employee_name: "Ahmed Hassan",
          job_title: "Senior Developer",
          salary: "25000",
          start_date: "2026-09-01",
          working_hours: "40 hours per week",
        },
      };

      const result = await generateDocument(
        {
          message: "Continue with the provided information",
          aiContext: contextWithFieldValues,
          conversationMessages,
        },
        deps(),
      );

      // The document should be successfully generated WITHOUT asking for missing fields again
      expect(result.success).toBe(true);
      expect(result.status).toBe("saved");
      expect(result.missing_fields).toBeUndefined();
      
      // Verify the field_values were actually used in the saved document
      expect(saveDocumentFn).toHaveBeenCalledWith(
        contextWithFieldValues,
        expect.objectContaining({
          metadata: expect.objectContaining({
            filled_fields: expect.objectContaining({
              employee_name: "Ahmed Hassan",
              job_title: "Senior Developer",
              salary: "25000",
              start_date: "2026-09-01",
              working_hours: "40 hours per week",
            }),
          }),
        }),
      );
    });

    it.each(["Contract", "Warning_Letter", "Termination_Letter"])(
      "REGRESSION: keeps prior structured document_type=%s across later missing-field submissions",
      async (documentType) => {
        getActiveTemplateFn.mockImplementation(async (_context, requestedType) => ({
          ...templateWithoutEmployeeId,
          document_type: requestedType,
          content_template: [
            `<h1>${requestedType}</h1>`,
            "<p>Employee: {{employee_name}}</p>",
            "<p>Position: {{job_title}}</p>",
            "<p>Salary: {{salary}}</p>",
            "<p>Start: {{start_date}}</p>",
          ].join("\n"),
        }));
        saveDocumentFn.mockImplementation(async (_context, payload) => ({
          ...saveResponse,
          document_id: `doc-${payload.document_type}`,
          document_type: payload.document_type,
        }));

        const conversationMessages = [
          {
            role: "user",
            content: "/generate document",
          },
          {
            role: "assistant",
            content: "I can generate a document draft, but I need the document type first.",
            missing_fields: [{
              field_name: "document_type",
              input_type: "dropdown",
              label: "Document Type",
              options: ["Contract", "Warning_Letter", "Termination_Letter"],
            }],
          },
          {
            role: "user",
            content: "Continue with the provided information",
            field_values: {
              document_type: documentType,
            },
          },
          {
            role: "assistant",
            content: "I can create that draft, but I need a few required fields first.",
            missing_fields: [
              { field_name: "employee_name", input_type: "text", label: "Employee Name", options: [] },
              { field_name: "job_title", input_type: "text", label: "Job Title", options: [] },
              { field_name: "salary", input_type: "number", label: "Salary", options: [] },
              { field_name: "start_date", input_type: "date", label: "Start Date", options: [] },
            ],
          },
        ];

        const currentContext = {
          ...aiContext,
          field_values: {
            employee_name: "Ahmed Hassan",
            job_title: "Senior Developer",
            salary: "25000",
            start_date: "2026-09-01",
          },
        };

        const result = await generateDocument(
          {
            message: "Continue with the provided information",
            aiContext: currentContext,
            conversationMessages,
          },
          deps(),
        );

        expect(result.success).toBe(true);
        expect(result.status).toBe("saved");
        expect(result.missing_fields).toBeUndefined();
        expect(getActiveTemplateFn).toHaveBeenCalledWith(currentContext, documentType);
        expect(saveDocumentFn).toHaveBeenCalledWith(
          currentContext,
          expect.objectContaining({
            document_type: documentType,
            metadata: expect.objectContaining({
              filled_fields: expect.objectContaining({
                employee_name: "Ahmed Hassan",
                job_title: "Senior Developer",
                salary: "25000",
                start_date: "2026-09-01",
              }),
            }),
          }),
        );
        expect(result.document.document_type).toBe(documentType);
        expect(result.result_card.doc_type).toBe(documentType);
      },
    );

    it("REGRESSION: field_values take precedence over conversation history extraction", async () => {
      // When field_values are provided (from form submission), they should override
      // any potentially incorrect values extracted from conversation text
      
      getActiveTemplateFn.mockResolvedValue(templateWithoutEmployeeId);

      const conversationMessages = [
        {
          role: "user",
          content: "Create contract for Mohamed with salary 15000",
        },
        {
          role: "assistant",
          content: "I need more fields.",
        },
      ];

      const contextWithFieldValues = {
        ...aiContext,
        field_values: {
          employee_name: "Ahmed Hassan", // Different from conversation text
          job_title: "Developer",
          salary: "25000", // Different from conversation text
          start_date: "2026-09-01",
          working_hours: "40 hours",
        },
      };

      const result = await generateDocument(
        {
          message: "Continue",
          aiContext: contextWithFieldValues,
          conversationMessages,
        },
        deps(),
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("saved");
      
      // The field_values should be used, NOT the conversation-extracted values
      expect(saveDocumentFn).toHaveBeenCalledWith(
        contextWithFieldValues,
        expect.objectContaining({
          metadata: expect.objectContaining({
            filled_fields: expect.objectContaining({
              employee_name: "Ahmed Hassan", // from field_values, not "Mohamed"
              salary: "25000", // from field_values, not "15000"
            }),
          }),
        }),
      );
    });
  });
});
