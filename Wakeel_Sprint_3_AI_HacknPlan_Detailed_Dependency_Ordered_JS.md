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

## Story 3.1 — AI Service Foundation & Gateway

### Task 3.1.1 — Create AI Service Foundation

**Dependency:** None  
**Execution:** BLOCKING — first task in the sprint

#### Goal
Create the standalone Node.js + Express AI service foundation using JavaScript (ES Modules). Establish the project structure, configuration, middleware, logging, error handling, validation, health check, and architecture documentation.

#### Implement
- Initialize/configure the Node.js + Express project.
- Use JavaScript only. Do NOT introduce TypeScript.
- Use ES Modules (`"type": "module"`).
- Create the agreed AI service folder structure:
  - `src/orchestrator/`
  - `src/skills/`
  - `src/tools/`
  - `src/rag/`
  - `src/llm/`
  - `src/data-access/`
  - `src/integrations/`
  - `src/config/`
  - `src/middleware/`
  - `src/routes/`
  - `src/controllers/`
  - `src/shared/`
  - `src/contracts/`
- Add centralized environment configuration and validation with Zod.
- Add centralized Winston logging.
- Add centralized Express error handling.
- Add reusable request validation middleware.
- Add security middleware (`helmet`, `cors`, JSON parsing).
- Add MongoDB/Mongoose connection infrastructure.
- Add architecture documentation that every future AI coding agent must read before modifying the project.
- Document folder responsibilities, dependency rules, naming conventions, and where each AI concern belongs.
- Keep routes/controllers thin; AI business logic must live in services/modules.

#### Endpoint

`GET /health`

#### Response

```json
{
  "status": "ok",
  "service": "wakeel-ai"
}
```

#### Required Environment Configuration

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

#### Done When
- Service starts successfully.
- `GET /health` returns HTTP 200 with the required response.
- Missing required configuration fails clearly.
- MongoDB connection infrastructure exists and is isolated from business logic.
- Express routes/controllers contain no AI business logic.
- `docs/AI_ARCHITECTURE.md` exists and clearly defines the architecture rules.
- Future AI coding agents are instructed to read the architecture document before making changes.
- Project uses JavaScript only; no `.ts`/`.tsx` source files are introduced.

#### Blocks
- Task 3.1.2
- All later stories/tasks.

---

### Task 3.1.2 — Implement `POST /api/ai/chat`

**Dependency:** 3.1.1  
**Execution:** BLOCKING

#### Goal
Create the public AI chat gateway endpoint in the standalone AI service. The endpoint receives the authenticated user's AI request/context and passes it into the AI orchestration layer without putting orchestration logic inside the route/controller.

#### Endpoint

`POST /api/ai/chat`

#### Request

```json
{
  "message": "How many leave days do I have left?",
  "conversationId": "conversation-uuid",
  "context": {
    "userId": "user-uuid",
    "companyId": "company-uuid",
    "role": "employee"
  }
}
```

#### Response

```json
{
  "conversationId": "conversation-uuid",
  "message": "You have 12 leave days remaining.",
  "type": "text",
  "sources": [],
  "actions": []
}
```

#### Implement
- Add request validation with Zod.
- Add chat route and controller.
- Validate required user/company context.
- Pass the request to the orchestration service through a clean service boundary.
- Do not implement routing/skill-selection logic inside the controller.
- Return a consistent AI chat response shape.
- Add structured error handling.
- Add request logging without logging secrets.

#### Done When
- Endpoint accepts a valid chat request.
- Invalid requests return a structured 4xx response.
- Controller delegates to the AI layer.
- Response follows the shared chat response contract.
- No business logic is placed in the route/controller.

#### Blocks
- Story 3.2 and all tasks that consume the chat gateway.

---

# Story 3.2 — Orchestration & Skills

## Task 3.2.1 — Implement OrchestratorService

**Dependency:** 3.1.2  
**Execution:** BLOCKING

### Goal
Implement the central orchestration service responsible for analyzing an incoming user request, determining which skill/tool/data sources are required, executing the required capabilities, and producing the final AI response.

### Implement
- Create `OrchestratorService` as a JavaScript service/module.
- Accept the validated AI chat request and AI context.
- Determine the user's intent.
- Select one or more registered skills/tools.
- Determine whether knowledge retrieval is required.
- Determine whether employee/company context is required.
- Execute selected capabilities in the correct order.
- Aggregate results, sources, and actions.
- Pass the gathered context to the LLM for final response generation.
- Return the shared chat response shape.
- Keep orchestration logic independent from HTTP routes/controllers.
- Do not hardcode employee/company-specific rules inside the orchestrator.

### Done When
- Orchestrator can receive a chat request.
- Orchestrator can select and execute registered capabilities.
- Orchestrator can request RAG/context data when required.
- Orchestrator returns a consistent final response.
- Later skills can plug into the orchestrator without changing the gateway.

### Blocks
- Tasks 3.3.3–3.9.3 where orchestration is consumed.

---

## Task 3.2.2 — Create Skill/Tool Registry and Contracts

**Dependency:** 3.2.1  
**Execution:** BLOCKING

### Goal
Create the shared JavaScript contracts and registries that allow the orchestrator to discover and execute AI skills/tools consistently.

### JavaScript Contract Shape

Use plain JavaScript objects/functions and Zod schemas instead of TypeScript interfaces.

#### AI Context

```js
{
  userId: "",
  companyId: "",
  role: "",
  conversationId: ""
}
```

#### Skill Definition

```js
{
  name: "",
  description: "",
  inputSchema: zodSchema,
  execute: async (input, context) => {}
}
```

#### Skill Result

```js
{
  success: true,
  data: null,
  message: "",
  sources: [],
  action: null
}
```

#### Chat Response

```js
{
  conversationId: "",
  message: "",
  type: "text",
  sources: [],
  actions: []
}
```

### Implement
- Create Zod schemas for shared AI input/output validation.
- Create a Skill Registry.
- Create a Tool Registry.
- Provide registration and lookup functions.
- Prevent duplicate registrations.
- Validate registered skill/tool definitions.
- Keep registries independent from specific skills.
- Export shared contracts and registries from a central module.
- Ensure all later skills/tools use these shared shapes.

### Done When
- All later skills/tools can register through the shared registry.
- The orchestrator can discover capabilities through the registry.
- Shared response/context shapes are defined once.
- No TypeScript interfaces/types are introduced.

### Blocks
- Story 3.3 onward.

---

# Story 3.3 — RAG Knowledge Layer

## Task 3.3.1 — Implement `POST /api/knowledge/ingest`

**Dependency:** 3.2.2  
**Execution:** BLOCKING

### Goal
Create the knowledge ingestion endpoint for Egyptian labor law documents and optional company policy documents.

### Endpoint

`POST /api/knowledge/ingest`

### Request

```json
{
  "companyId": "company-uuid",
  "knowledgeType": "labor-law",
  "documentId": "document-uuid",
  "title": "Egyptian Labor Law",
  "content": "Document text..."
}
```

### Response

```json
{
  "success": true,
  "documentId": "document-uuid",
  "chunksCreated": 25
}
```

### Implement
- Validate request body.
- Split document content into retrieval-friendly chunks.
- Generate embeddings.
- Store chunks, metadata, and embeddings in MongoDB.
- Preserve tenant/company scope for company policies.
- Mark labor-law knowledge as globally applicable.
- Return ingestion summary.
- Keep ingestion logic in a service, not the controller.

### Blocks
- 3.3.2
- 3.3.3

---

## Task 3.3.2 — Configure MongoDB Vector Search

**Dependency:** 3.3.1  
**Execution:** BLOCKING

### Goal
Configure MongoDB Atlas Vector Search for the stored knowledge embeddings.

### Implement
- Define the MongoDB collection/schema for knowledge chunks.
- Store embedding vectors with required metadata.
- Create/configure the vector search index using `VECTOR_INDEX_NAME`.
- Configure embedding dimensions based on the selected embedding model.
- Support filtering by:
  - knowledge type
  - company ID
  - document ID where applicable
- Ensure company policy retrieval cannot cross company boundaries.

### Done When
- Knowledge chunks can be stored with embeddings.
- MongoDB vector index is configured.
- Vector search supports tenant-aware metadata filtering.

---

## Task 3.3.3 — Implement KnowledgeRetrievalService

**Dependency:** 3.3.2  
**Execution:** BLOCKING

### Goal
Provide reusable semantic retrieval for the orchestrator and legal/policy skills.

### Implement
- Create `KnowledgeRetrievalService`.
- Generate an embedding for the user query.
- Execute MongoDB vector search.
- Apply company/knowledge-type filters.
- Return the most relevant chunks.
- Include source metadata for the final AI response.
- Prevent company policy data from being returned to another company.

### Response Shape

```js
{
  chunks: [],
  sources: []
}
```

---

# Story 3.4 — Employee & Company Context

## Task 3.4.1 — Implement EmployeeContextService

**Dependency:** 3.2.2  
**Execution:** Can run in parallel with Story 3.3 after 3.2.2

### Goal
Retrieve employee-specific data required by AI skills.

### Implement
- Create `EmployeeContextService`.
- Retrieve employee information using the authenticated user's identity.
- Retrieve relevant leave balance and employment information.
- Use the existing .NET Wakeel backend/API where the business data is owned by .NET.
- Return only the data required by the requesting skill.
- Enforce user/company scope.

### Response

```js
{
  employeeId: "",
  fullName: "",
  department: "",
  jobTitle: "",
  employmentStatus: "",
  leaveBalance: {}
}
```

---

## Task 3.4.2 — Implement CompanyContextService

**Dependency:** 3.2.2  
**Execution:** Can run in parallel with Story 3.3 after 3.2.2

### Goal
Retrieve company-specific context required by AI skills.

### Implement
- Create `CompanyContextService`.
- Retrieve company information and relevant configuration.
- Retrieve company policy metadata when applicable.
- Keep company context scoped to `companyId`.
- Do not duplicate business ownership from the .NET backend.

### Response

```js
{
  companyId: "",
  companyName: "",
  policies: []
}
```

---

# Story 3.5 — Calculations

## Task 3.5.1 — Implement CalculationService

**Dependency:** 3.2.2 and required context services when a calculation needs employee/company data  
**Execution:** Can start after 3.2.2; integrate with orchestrator after 3.2.1

### Goal
Implement deterministic calculation functionality for AI requests.

### Implement
- Create `CalculationService`.
- Define supported calculation operations.
- Validate calculation inputs with Zod.
- Perform calculations deterministically in JavaScript.
- Do not ask the LLM to perform arithmetic when deterministic code can do it.
- Return structured calculation results.
- Expose the service to the orchestrator through a registered tool/skill.

### Response

```js
{
  success: true,
  result: 0,
  unit: "",
  explanation: ""
}
```

---

# Story 3.6 — Document Generation

## Task 3.6.1 — Implement DocumentGenerationService

**Dependency:** 3.2.2, 3.4.2, and RAG retrieval where document generation requires legal/company policy context  
**Execution:** Can start after required dependencies are available

### Goal
Generate structured employment/HR documents using deterministic templates plus AI-generated content where appropriate.

### Implement
- Create `DocumentGenerationService`.
- Define supported document types.
- Validate document input.
- Retrieve required employee/company context.
- Retrieve applicable labor-law/company-policy knowledge when needed.
- Generate structured document content.
- Keep document-generation logic outside the HTTP controller.
- Return document content and metadata.
- Do not invent legal requirements unsupported by retrieved sources.

### Response

```js
{
  success: true,
  documentType: "",
  title: "",
  content: "",
  sources: []
}
```

---

# Story 3.7 — Leave Requests

## Task 3.7.1 — Implement LeaveRequestTool

**Dependency:** 3.4.1 and 3.2.2  
**Execution:** Can start after required contracts/context are ready

### Goal
Allow the AI to initiate an employee leave request through the existing .NET backend API.

### Implement
- Create `LeaveRequestTool`.
- Validate leave request input.
- Check employee context/leave balance when required.
- Call the existing .NET leave-request API.
- Never directly modify leave business data in the AI service database.
- Return the API result as a structured AI action.
- Handle backend validation/errors safely.
- Register the tool with the Tool Registry.

### Input

```js
{
  leaveType: "",
  startDate: "",
  endDate: "",
  reason: ""
}
```

### Response

```js
{
  success: true,
  action: {
    type: "leave_request",
    status: "",
    requestId: ""
  },
  message: ""
}
```

---

# Story 3.8 — Legal & Policy Skills

## Task 3.8.1 — Implement LaborLawSkill

**Dependency:** 3.3.3 and 3.2.2  
**Execution:** BLOCKING for labor-law chat behavior

### Goal
Answer Egyptian labor-law questions using retrieved legal knowledge.

### Implement
- Create `LaborLawSkill`.
- Define skill input validation.
- Retrieve relevant Egyptian labor-law chunks.
- Provide retrieved sources to the LLM.
- Require answers to stay grounded in retrieved legal sources.
- Return citations/source metadata.
- Register the skill with the Skill Registry.

### Response

```js
{
  success: true,
  message: "",
  sources: []
}
```

---

## Task 3.8.2 — Implement CompanyPolicySkill

**Dependency:** 3.3.3, 3.4.2, and 3.2.2  
**Execution:** BLOCKING for company-policy chat behavior

### Goal
Answer company-policy questions using the authenticated company's policy knowledge.

### Implement
- Create `CompanyPolicySkill`.
- Retrieve company-scoped policy chunks.
- Never retrieve another company's policies.
- Clearly distinguish company policy from Egyptian labor law.
- Return sources.
- Register the skill with the Skill Registry.

### Response

```js
{
  success: true,
  message: "",
  sources: []
}
```

---

# Story 3.9 — Agent, Security & Tests

## Task 3.9.1 — Configure LangChain Agent and Tools

**Dependency:** 3.2.1, 3.2.2, and required skills/tools  
**Execution:** BLOCKING before final AI behavior is considered complete

### Goal
Connect LangChain to the existing orchestrator/skill/tool architecture.

### Implement
- Configure the selected LLM through LangChain.
- Configure the LangChain agent.
- Register approved tools.
- Ensure the agent can use:
  - calculations
  - document generation
  - employee/company context
  - knowledge retrieval
  - leave request tool
- Keep tool execution controlled by the application registry.
- Do not allow arbitrary tool execution.
- Integrate the agent with `OrchestratorService`.
- Keep the system synchronous; do not introduce BullMQ/workers/Celery.

### Done When
- Agent can receive an orchestrated request.
- Agent can select/use registered tools.
- Tool outputs are returned to the orchestrator.
- Final response follows the shared chat response shape.

---

## Task 3.9.2 — Add Security/Tenant Guards

**Dependency:** 3.2.2, 3.3.3, 3.4.1, 3.4.2  
**Execution:** Can run in parallel with skill implementation after dependencies are ready

### Goal
Protect AI data and tool execution from unauthorized access and cross-tenant leakage.

### Implement
- Validate authenticated user/company context.
- Enforce `companyId` scoping on all company data.
- Prevent cross-company RAG retrieval.
- Prevent users from impersonating another user/company through request payloads.
- Validate internal API authentication when calling .NET.
- Never expose API keys/secrets in responses or logs.
- Add basic prompt-injection/tool-use safeguards.
- Restrict agent tools to explicitly registered tools.

### Done When
- Cross-company data access is rejected.
- Unauthorized tool calls are rejected.
- Sensitive configuration is not exposed.
- AI cannot override tenant identity supplied by the authenticated gateway.

---

## Task 3.9.3 — Add AI Integration Tests

**Dependency:** 3.1.2 and the implemented AI components  
**Execution:** Incremental; final pass after all Story 3 components are integrated

### Goal
Verify the complete AI service behavior.

### Implement
Test at minimum:
- `GET /health`
- `POST /api/ai/chat`
- Request validation
- Orchestrator routing
- Skill registration/lookup
- Tool registration/lookup
- RAG ingestion
- Vector retrieval
- Tenant isolation
- Employee/company context retrieval
- Calculation execution
- Document generation
- Leave request tool
- Labor-law retrieval/grounding
- Company-policy retrieval/grounding
- Agent tool execution
- Error handling

### Done When
- Critical AI flows have automated coverage.
- Cross-tenant retrieval tests fail safely.
- Tool/API failures return controlled errors.
- The complete chat flow can be exercised end-to-end with mocked external dependencies.

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
