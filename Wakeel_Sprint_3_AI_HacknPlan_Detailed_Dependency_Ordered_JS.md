# Wakeel Sprint 3 — AI HacknPlan
## JavaScript Implementation Edition

> **Mandatory:** The standalone AI service is **Node.js + Express + JavaScript (ES Modules)**.
> TypeScript MUST NOT be introduced anywhere in this service.

---

# 0. Mandatory Technology Rules

## Runtime

- Node.js
- Express
- JavaScript
- ES Modules (`"type": "module"`)
- LangChain for AI orchestration/LLM integration
- MongoDB/Mongoose for data access
- Zod for runtime validation
- Winston for centralized logging

## TypeScript prohibition

Do NOT create or introduce:

- `.ts` / `.tsx` files
- `tsconfig.json`
- TypeScript `interface`
- TypeScript `type`
- Type annotations
- TypeScript generics

All code examples in this document MUST be JavaScript.

## Contracts in JavaScript

Use JavaScript objects/functions/classes and **Zod schemas** for runtime validation.

Example:

```js
import { z } from "zod";

export const AIContextSchema = z.object({
  userId: z.string(),
  companyId: z.string(),
  role: z.string(),
  conversationId: z.string(),
});
```

A skill is a normal JavaScript object:

```js
const calculationSkill = {
  name: "calculation",
  description: "Performs deterministic HR calculations.",
  inputSchema: calculationInputSchema,

  async execute(input, context) {
    // implementation
  },
};

export default calculationSkill;
```

JSDoc may be used for editor hints/documentation when useful.

---

# 1. Architecture Rules

The service is a standalone synchronous AI service.

```text
Wakeel Web/Mobile
       |
       v
.NET Wakeel Backend
       |
       v
Node.js + Express AI Service
       |
       +--> Orchestrator
       +--> Skills
       +--> Tools
       +--> RAG
       +--> LLM
       +--> Data Access
       +--> Wakeel API Integrations
```

The .NET backend remains responsible for authentication/authorization, normal application persistence, business-critical application logic, and existing business operations.

The AI service is responsible for orchestration, skills, RAG, LLM interaction, AI-side deterministic calculations, document-generation logic, tools, and approved calls to Wakeel APIs.

## No worker architecture

Do NOT introduce:

- BullMQ
- Redis workers
- Celery
- RabbitMQ worker infrastructure
- background worker infrastructure

The initial implementation is synchronous HTTP request/response.

---

# 2. Permanent Architecture Document

Create and maintain:

```text
docs/AI_ARCHITECTURE.md
```

This is the source of truth for the AI service architecture.

It must document:

- project purpose
- technology stack
- folder responsibilities
- dependency direction
- naming conventions
- request/response conventions
- error conventions
- AI context
- skill structure
- tool structure
- orchestrator responsibilities
- RAG responsibilities
- LLM abstraction
- Wakeel API integration rules
- data-access rules
- configuration rules
- testing rules
- prohibited patterns
- future module map

Every future AI coding agent MUST read this file before changing the AI service.

---

# 3. Dependency Order

```text
3.1.1
  |
  v
3.2.1
  |
  +----------------------+
  |                      |
  v                      v
3.3.1                  3.3.2
  |                      |
  +----------+-----------+
             |
             v
           3.4.1
             |
             v
           3.5.1
             |
             v
           3.5.2
             |
       +-----+------+
       |            |
       v            v
     3.6.1        3.6.2
       |            |
       +-----+------+
             |
             v
           3.7.1
             |
             v
           3.8.1
             |
             v
           3.9.1
             |
             v
        AI Skills/Actions
```

Tasks explicitly marked **PARALLEL** may run together after their stated dependencies are complete.

---

# Story 3.1 — AI Service Foundation

## Task 3.1.1 — Create the AI Service Foundation

**Dependency:** None  
**Execution:** BLOCKING — first task in Sprint 3

### Goal

Create the standalone Node.js + Express JavaScript service that will contain all AI functionality.

### Project structure

Create:

```text
src/
├── config/
├── contracts/
├── controllers/
├── data-access/
├── integrations/
├── llm/
├── middleware/
├── orchestrator/
├── rag/
├── routes/
├── shared/
├── skills/
└── tools/

docs/
tests/
```

### Foundation files

Create:

```text
src/server.js
src/app.js
src/config/env.js
src/shared/logger.js
src/middleware/error-handler.js
src/middleware/validate-request.js
src/data-access/database.js
src/routes/health.routes.js
src/controllers/health.controller.js
docs/AI_ARCHITECTURE.md
.env.example
```

### Endpoint

```http
GET /health
```

### Response

```json
{
  "status": "ok",
  "service": "wakeel-ai"
}
```

### Environment

```env
PORT=
MONGODB_URI=
MONGODB_DB_NAME=
LLM_API_KEY=
LLM_MODEL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=
WAKEEL_API_BASE_URL=
WAKEEL_INTERNAL_API_KEY=
VECTOR_INDEX_NAME=
```

### Requirements

- Validate environment variables with Zod.
- Fail clearly when required configuration is missing.
- Use centralized Winston logging.
- Add centralized Express error handling.
- Add reusable Zod request-validation middleware.
- Add Mongoose connection infrastructure.
- Keep routes/controllers free of AI business logic.
- Do not implement orchestration, RAG, skills, or tools yet.

### Tests

Add:

- `/health` integration test.
- environment validation test.

### Done when

- Service starts.
- `/health` returns 200.
- Missing required configuration fails clearly.
- MongoDB connection infrastructure exists.
- Tests can run.
- No TypeScript files/configuration exist.
- No worker architecture exists.

### Blocks

All other AI implementation tasks.

---

# Story 3.2 — Shared AI Contracts & Infrastructure

## Task 3.2.1 — Define Shared AI Contracts

**Dependency:** 3.1.1  
**Execution:** BLOCKING

### Goal

Create the shared JavaScript contracts used by later AI modules.

These are runtime contracts, NOT TypeScript interfaces.

Use Zod schemas.

### AI Context

Create:

```text
src/contracts/ai-context.js
```

```js
import { z } from "zod";

export const AIContextSchema = z.object({
  userId: z.string(),
  companyId: z.string(),
  role: z.string(),
  conversationId: z.string(),
});
```

### Skill contract

Create:

```text
src/contracts/skill.js
```

A skill must provide:

```js
{
  name,
  description,
  inputSchema,
  execute
}
```

Validation helper:

```js
export function isAISkill(skill) {
  return Boolean(
    skill &&
    typeof skill.name === "string" &&
    typeof skill.description === "string" &&
    skill.inputSchema &&
    typeof skill.execute === "function"
  );
}
```

### Skill result

Create:

```text
src/contracts/skill-result.js
```

```js
import { z } from "zod";
import { SourceSchema } from "./source.js";
import { ActionSchema } from "./action.js";

export const SkillResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  message: z.string().optional(),
  sources: z.array(SourceSchema).optional(),
  action: ActionSchema.optional(),
});
```

### Source

Create:

```text
src/contracts/source.js
```

```js
import { z } from "zod";

export const SourceSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  type: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
```

### Action

Create:

```text
src/contracts/action.js
```

```js
import { z } from "zod";

export const ActionSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
```

### Chat response

Create:

```text
src/contracts/chat-response.js
```

```js
import { z } from "zod";
import { SourceSchema } from "./source.js";
import { ActionSchema } from "./action.js";

export const ChatResponseSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
  type: z.enum(["text", "action"]),
  sources: z.array(SourceSchema),
  actions: z.array(ActionSchema),
});
```

### Tool contract

Create:

```text
src/contracts/tool.js
```

A tool must provide:

```js
{
  name,
  description,
  inputSchema,
  execute
}
```

Validation helper:

```js
export function isAITool(tool) {
  return Boolean(
    tool &&
    typeof tool.name === "string" &&
    typeof tool.description === "string" &&
    tool.inputSchema &&
    typeof tool.execute === "function"
  );
}
```

### Contract index

Create:

```text
src/contracts/index.js
```

Export all schemas/helpers.

### Done when

- No TypeScript syntax exists.
- All contracts are JavaScript modules.
- Zod is used for runtime validation.
- Skills/tools use consistent shapes.
- Later modules can import from `src/contracts`.

### Blocks

- Orchestrator
- Skill registry
- Tool registry
- Agent configuration
- Chat integration

---

# Story 3.3 — LLM Infrastructure

## Task 3.3.1 — Create LLM Abstraction

**Dependency:** 3.2.1  
**Execution:** BLOCKING

### Goal

Centralize LangChain chat-model creation.

Create:

```text
src/llm/
├── chat-model.js
├── prompt-builder.js
└── index.js
```

### Requirements

`chat-model.js` must:

- read configuration from `config`
- initialize the selected LangChain chat model
- avoid hardcoded API keys
- avoid hardcoded model names
- expose a reusable model instance/factory

Example:

```js
const model = getChatModel();
const response = await model.invoke(messages);
```

### Prompt builder

Create reusable prompt-building helpers.

Do not put skill-specific business prompts into this generic module.

### Done when

LLM initialization is centralized and later modules do not directly configure providers.

---

## Task 3.3.2 — Create Embedding Abstraction

**Dependency:** 3.2.1  
**Execution:** PARALLEL with 3.3.1

### Goal

Create the embedding abstraction used by RAG.

Create:

```text
src/llm/embeddings.js
```

Expose:

```js
getEmbeddingModel()
```

It must support document and query embeddings.

Do not implement vector ingestion here.

---

# Story 3.4 — Data Access & RAG Foundation

## Task 3.4.1 — Create Vector Data Access Layer

**Dependency:** 3.3.2  
**Execution:** BLOCKING

### Goal

Create MongoDB/Mongoose infrastructure for AI knowledge.

Create:

```text
src/data-access/
├── database.js
├── knowledge-repository.js
└── index.js
```

Repository operations:

```js
insertKnowledgeDocument(document)
searchKnowledge({ queryVector, companyId, sourceTypes, topK })
```

### Knowledge document shape

```json
{
  "title": "Egyptian Labour Law",
  "content": "...",
  "sourceType": "labor-law",
  "companyId": null,
  "chunkIndex": 0,
  "embedding": []
}
```

Company policy example:

```json
{
  "title": "Company Leave Policy",
  "content": "...",
  "sourceType": "company-policy",
  "companyId": "company-id",
  "chunkIndex": 0,
  "embedding": []
}
```

### Isolation rule

- Global legal knowledge may use `companyId: null`.
- Company policy must use the actual company ID.
- Retrieval must never mix one company's private policy with another company's results.

### Done when

Knowledge can be inserted and vector-searched through the repository layer.

---

# Story 3.5 — Knowledge Ingestion & Retrieval

## Task 3.5.1 — Create Knowledge Embedding Endpoint

**Dependency:** 3.4.1  
**Execution:** BLOCKING

### Endpoint

```http
POST /knowledge/ingest
```

### Request

```json
{
  "title": "Company Leave Policy",
  "content": "Employees are entitled to...",
  "sourceType": "company-policy",
  "companyId": "company-id"
}
```

### Response

```json
{
  "success": true,
  "documentId": "document-id",
  "chunksCreated": 8
}
```

### Flow

1. Validate with Zod.
2. Split content into chunks.
3. Generate embeddings.
4. Store chunks and vectors.
5. Return ingestion result.

Create:

```text
src/rag/
├── ingestion-service.js
├── chunking.js
└── retrieval-service.js
```

The route/controller must not contain embedding logic.

---

## Task 3.5.2 — Create Knowledge Search Service

**Dependency:** 3.5.1  
**Execution:** BLOCKING

### Function

```js
searchKnowledge({
  query,
  companyId,
  sourceTypes,
  topK,
})
```

### Retrieval behavior

Support:

- Egyptian labor law
- company policy
- both when required
- company-scoped retrieval

### Return

```json
[
  {
    "id": "document-id",
    "title": "Company Leave Policy",
    "content": "...",
    "score": 0.91,
    "metadata": {}
  }
]
```

---

# Story 3.6 — Skill & Tool Infrastructure

## Task 3.6.1 — Create Skill Registry

**Dependency:** 3.2.1  
**Execution:** BLOCKING before orchestrator

Create:

```text
src/skills/
├── registry.js
├── calculations/
├── document-generation/
├── employee-questions/
├── policy/
└── labor-law/
```

Registry API:

```js
registerSkill(skill)
getSkill(name)
getAllSkills()
```

The orchestrator must discover skills through this registry.

---

## Task 3.6.2 — Create Tool Registry

**Dependency:** 3.2.1  
**Execution:** PARALLEL with 3.6.1

Create:

```text
src/tools/
├── registry.js
├── leave-request/
└── employee-data/
```

Registry API:

```js
registerTool(tool)
getTool(name)
getAllTools()
```

### Distinction

**Skills** are AI capabilities:

```text
calculation
document generation
policy
labor law
employee questions
```

**Tools** provide external/application access:

```text
get employee data
get leave balance
create leave request
```

---

# Story 3.7 — Wakeel API Integration

## Task 3.7.1 — Create Wakeel API Client

**Dependency:** 3.1.1  
**Execution:** PARALLEL with LLM/RAG foundation where possible

Create:

```text
src/integrations/wakeel/
├── wakeel-client.js
├── employee-api.js
├── leave-api.js
└── index.js
```

Use:

```env
WAKEEL_API_BASE_URL=
WAKEEL_INTERNAL_API_KEY=
```

### Client responsibilities

- base URL
- internal authentication
- timeout
- JSON handling
- error normalization
- logging

Skills/tools must NOT make raw HTTP calls directly.

### Employee operations

Expose only operations actually supported by the .NET backend, such as:

```js
getEmployeeById(...)
getEmployeeContext(...)
```

### Leave operations

Expose only existing backend operations, such as:

```js
getEmployeeLeaveBalance(...)
createLeaveRequest(...)
```

**Do not invent .NET endpoints.** Confirm actual backend routes before implementing the integration.

---

# Story 3.8 — AI Orchestrator

## Task 3.8.1 — Create AI Orchestrator

**Dependencies:**

- 3.2.1
- 3.3.1
- 3.5.2
- 3.6.1
- 3.6.2
- 3.7.1

**Execution:** BLOCKING

Create:

```text
src/orchestrator/
├── orchestrator.js
├── intent-router.js
├── context-builder.js
└── index.js
```

### Supported capabilities

1. Document generation
2. Calculations
3. Employee questions
4. Company policy
5. Egyptian labor law
6. Leave-request actions

### Input

```json
{
  "message": "How many leave days do I have left?",
  "context": {
    "userId": "user-id",
    "companyId": "company-id",
    "role": "Employee",
    "conversationId": "conversation-id"
  }
}
```

### Responsibilities

Determine:

- required skill
- required tools
- whether RAG is required
- whether company policy is required
- whether labor law is required
- whether an external action is required

### Action safety

The orchestrator must not execute state-changing actions merely because an action was mentioned.

For leave submission:

1. Determine explicit user intent.
2. Validate required data.
3. Use the approved leave tool.
4. Return an explicit action result.

---

# Story 3.9 — Chat Gateway

## Task 3.9.1 — Create AI Chat Endpoint

**Dependency:** 3.8.1  
**Execution:** BLOCKING

### Endpoint

```http
POST /chat
```

### Request

```json
{
  "message": "How many leave days do I have left?",
  "context": {
    "userId": "user-id",
    "companyId": "company-id",
    "role": "Employee",
    "conversationId": "conversation-id"
  }
}
```

### Response

```json
{
  "conversationId": "conversation-id",
  "message": "You have 12 annual leave days remaining.",
  "type": "text",
  "sources": [],
  "actions": []
}
```

### Action response

```json
{
  "conversationId": "conversation-id",
  "message": "Your leave request has been submitted.",
  "type": "action",
  "sources": [],
  "actions": [
    {
      "type": "leave-request-created",
      "payload": {
        "requestId": "request-id"
      }
    }
  ]
}
```

### Flow

```text
POST /chat
    |
    v
Validate request
    |
    v
Build AI context
    |
    v
Orchestrator
    |
    +--> Skill
    +--> RAG
    +--> Tool
    +--> Wakeel API
    |
    v
Validate ChatResponse
    |
    v
Return response
```

Keep the controller thin. AI logic belongs in orchestrator/skills/tools/RAG/LLM modules.

---

# Story 3.10 — AI Skills

## Task 3.10.1 — Calculation Skill

**Dependency:** 3.6.1

Implement deterministic HR calculations.

Examples:

- leave calculations
- salary calculations
- date calculations
- other approved HR calculations

Deterministic arithmetic must be implemented in JavaScript functions, not delegated blindly to the LLM.

Example:

```js
export function calculateRemainingLeave(allocated, used) {
  return allocated - used;
}
```

The LLM may explain a result but must not be the source of truth for arithmetic.

---

## Task 3.10.2 — Document Generation Skill

**Dependencies:** 3.6.1 + 3.3.1

Generate structured HR/employment documents.

Flow:

1. Receive structured input.
2. Validate required fields.
3. Retrieve required company/legal context.
4. Generate document content.
5. Return structured output.

Example:

```json
{
  "success": true,
  "data": {
    "documentType": "employment-contract",
    "content": "..."
  },
  "sources": []
}
```

---

## Task 3.10.3 — Employee Questions Skill

**Dependencies:** 3.6.1 + 3.7.1

Answer employee-specific questions using approved application data.

Examples:

- remaining leave
- employment status
- department
- employee information

Use tools to retrieve application data.

Do not directly bypass the .NET business layer unless explicitly approved.

---

## Task 3.10.4 — Policy Skill

**Dependencies:** 3.5.2 + 3.6.1

Answer company-policy questions using company-scoped vector retrieval.

Flow:

```text
Question
  |
  v
Policy skill
  |
  v
Company-scoped vector search
  |
  v
Relevant policy chunks
  |
  v
LLM
  |
  v
Answer + sources
```

If no company-specific policy exists, do not fabricate one.

---

## Task 3.10.5 — Labor Law Skill

**Dependencies:** 3.5.2 + 3.6.1

Answer Egyptian labor-law questions using the ingested legal knowledge.

Flow:

```text
Question
  |
  v
Labor Law Skill
  |
  v
Vector Search
  |
  v
Labor-law chunks
  |
  v
LLM
  |
  v
Answer + sources
```

Include retrieved sources where applicable.

---

# Story 3.11 — Leave Request AI Action

## Task 3.11.1 — Leave Request Tool

**Dependencies:** 3.6.2 + 3.7.1 + 3.10.3

Allow the AI to submit leave requests through the existing .NET backend.

### Flow

```text
User request
    |
    v
Orchestrator
    |
    v
Leave-request tool
    |
    +--> validate employee/context
    +--> retrieve leave balance if needed
    +--> validate requested dates
    +--> call Wakeel .NET API
    |
    v
Return Action
```

### Input

```json
{
  "employeeId": "employee-id",
  "leaveType": "annual",
  "startDate": "2026-08-10",
  "endDate": "2026-08-14",
  "reason": "Personal"
}
```

### Output

```json
{
  "success": true,
  "data": {
    "requestId": "request-id",
    "status": "Pending"
  },
  "action": {
    "type": "leave-request-created",
    "payload": {
      "requestId": "request-id"
    }
  }
}
```

The .NET backend remains the source of truth for leave business rules.

---

# Story 3.12 — RAG Knowledge Sources

## Task 3.12.1 — Ingest Egyptian Labor Law

**Dependency:** 3.5.1

Prepare the approved Egyptian labor-law source, chunk it, generate embeddings, store vectors, and attach metadata.

Metadata:

```json
{
  "sourceType": "labor-law",
  "title": "Egyptian Labour Law",
  "companyId": null
}
```

Done when labor-law questions can retrieve relevant legal chunks.

---

## Task 3.12.2 — Company Policy Ingestion

**Dependency:** 3.5.1

Allow company-specific policy documents to be embedded and stored.

Every policy document must be scoped to:

```text
companyId
```

Retrieval must never leak one company's policy into another company's response.

---

# Story 3.13 — Security & Reliability

## Task 3.13.1 — Secure AI Service Configuration

**Dependency:** 3.1.1

Implement:

- strict environment validation
- secret protection
- no API keys in logs
- no secrets in responses
- internal Wakeel API authentication
- input validation
- tool input validation

---

## Task 3.13.2 — AI Error Handling

**Dependency:** 3.8.1

Handle:

- invalid request
- LLM failure
- embedding failure
- vector search failure
- Wakeel API failure
- tool validation failure
- unsupported request
- internal error

Example:

```json
{
  "error": {
    "code": "AI_TOOL_EXECUTION_FAILED",
    "message": "The requested action could not be completed."
  }
}
```

---

# Story 3.14 — Testing & Verification

## Task 3.14.1 — Foundation Tests

**Dependency:** 3.1.1

Test:

- `/health`
- environment validation
- request validation
- error middleware

## Task 3.14.2 — Contract Tests

**Dependency:** 3.2.1

Test:

- AI context validation
- skill validation
- tool validation
- chat response validation
- source validation
- action validation

## Task 3.14.3 — RAG Tests

**Dependency:** 3.5.2

Test:

- chunking
- embedding flow
- vector retrieval
- company isolation
- labor-law retrieval

## Task 3.14.4 — Orchestrator Tests

**Dependency:** 3.8.1

Test routing for:

- calculation
- document generation
- employee question
- company policy
- labor law
- leave request

## Task 3.14.5 — Chat Integration Tests

**Dependency:** 3.9.1

Test:

```http
POST /chat
```

with mocked:

- LLM
- embeddings
- MongoDB
- Wakeel API

Automated tests must not depend on production external services.

---

# Final Folder Structure

```text
wakeelai-ai/
├── docs/
│   ├── AI_ARCHITECTURE.md
│   └── REFERENCE_AI_STACK.md
│
├── src/
│   ├── config/
│   │   └── env.js
│   ├── contracts/
│   │   ├── ai-context.js
│   │   ├── action.js
│   │   ├── chat-response.js
│   │   ├── skill.js
│   │   ├── skill-result.js
│   │   ├── source.js
│   │   ├── tool.js
│   │   └── index.js
│   ├── controllers/
│   ├── data-access/
│   │   ├── database.js
│   │   ├── knowledge-repository.js
│   │   └── index.js
│   ├── integrations/
│   │   └── wakeel/
│   │       ├── wakeel-client.js
│   │       ├── employee-api.js
│   │       ├── leave-api.js
│   │       └── index.js
│   ├── llm/
│   │   ├── chat-model.js
│   │   ├── embeddings.js
│   │   ├── prompt-builder.js
│   │   └── index.js
│   ├── middleware/
│   ├── orchestrator/
│   ├── rag/
│   ├── routes/
│   ├── shared/
│   │   └── logger.js
│   ├── skills/
│   ├── tools/
│   ├── app.js
│   └── server.js
├── tests/
├── .env.example
├── package.json
└── README.md
```

---

# Definition of Done

- [ ] JavaScript only.
- [ ] Node.js + Express service runs independently.
- [ ] No TypeScript files/configuration.
- [ ] `/health` works.
- [ ] Environment validation works.
- [ ] Centralized Winston logging exists.
- [ ] Centralized error handling exists.
- [ ] Shared Zod contracts exist.
- [ ] LLM abstraction exists.
- [ ] Embedding abstraction exists.
- [ ] MongoDB/vector infrastructure exists.
- [ ] Knowledge ingestion works.
- [ ] Vector retrieval works.
- [ ] Company-policy isolation works.
- [ ] Labor-law knowledge is available.
- [ ] Skill registry exists.
- [ ] Tool registry exists.
- [ ] Wakeel API client exists.
- [ ] Orchestrator exists.
- [ ] `/chat` exists.
- [ ] Required AI skills exist.
- [ ] Leave-request tool exists.
- [ ] Tests cover foundation, contracts, RAG and orchestration.
- [ ] No BullMQ/Redis/Celery worker architecture was introduced.

---

# AI Coding Agent Rules

Whenever an AI coding agent implements a task from this document:

1. Read `docs/AI_ARCHITECTURE.md`.
2. Read the exact task.
3. Check its dependencies.
4. Inspect existing code before creating files.
5. Reuse existing infrastructure.
6. Use JavaScript only.
7. Use ES Modules.
8. Use Zod for runtime validation.
9. Follow the existing folder structure.
10. Do not invent a new architecture.
11. Do not introduce TypeScript.
12. Do not introduce workers/BullMQ/Celery/Redis workers.
13. Do not invent .NET backend endpoints.
14. Reuse the centralized Wakeel API client.
15. Keep routes/controllers thin.
16. Put logic in the appropriate service/skill/tool/RAG/orchestrator module.
17. Add tests for new behavior.
18. Run relevant tests before completion.
19. Update `docs/AI_ARCHITECTURE.md` only when architecture actually changes.
20. Do not implement unrelated tasks unless they are direct dependencies.

The objective is a predictable repository where every future AI coding agent knows exactly where code belongs and follows the same JavaScript architecture.
