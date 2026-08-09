
# Wakeel AI — Sprint 3 AI Backlog
## Dependency-Ordered HacknPlan Specification

> **Purpose of this version:** ترتيب التنفيذ هنا مقصود وليس مجرد ترتيب شكلي. كل Task موضح أمامها هل هي **Blocking** لما بعدها، أو **Parallel** ويمكن تنفيذها بالتوازي بعد اكتمال Dependency معينة.
>
> **Scope:** AI team only. Backend (.NET), Web, and Mobile implementation tasks remain outside this backlog.

---

# 1. Sprint Architecture

```text
Web / Mobile
     |
     v
.NET Wakeel API
     |
     v
Node.js + Express AI Service
     |
     +--> AI Gateway
     |
     +--> Orchestrator
     |      |
     |      +--> Calculation Skill
     |      +--> Employee/Company Context
     |      +--> Labor Law RAG
     |      +--> Company Policy RAG
     |      +--> Document Generation
     |      +--> Leave Request Tool
     |
     +--> Knowledge Ingestion
     |      |
     |      +--> Embeddings
     |      +--> MongoDB Vector Search
     |
     v
LLM Response
```

## Technology decisions

- AI service: **Node.js + Express**
- Language: **JavaScript**
- AI framework: **LangChain**
- Vector database: **MongoDB / MongoDB Atlas Vector Search**
- Main business data remains owned by the .NET backend.
- AI service can read required employee/company context through the approved data-access/integration layer.
- Business mutations must go through existing .NET APIs.
- Every company-scoped operation must enforce `companyId` from authenticated context.
- Deterministic calculations must not be delegated to the LLM.
- RAG responses must preserve source metadata.

---

# 2. Dependency Rules

Use these labels when creating the HacknPlan tasks:

- **BLOCKING:** This task must be completed before the dependent task can start implementation.
- **PARALLEL:** This task can be implemented at the same time as another task after its listed dependency is complete.
- **SOFT DEPENDENCY:** Implementation can start, but final integration/testing requires the dependency.
- **INTEGRATION BLOCKER:** The task itself may be developed earlier, but it cannot be marked Done until the dependency is available.

## Critical path

```text
T1 Foundation
  ↓
T2 Shared AI contracts + configuration
  ↓
T3 Data access + .NET integration layer
  ↓
T4 RAG infrastructure
  ↓
T5 Core skills/tools
  ↓
T6 Orchestrator + LangChain agent
  ↓
T7 AI Gateway integration
  ↓
T8 Security + end-to-end tests
```

## Parallelization

After **T2**, these can proceed in parallel:

```text
             ┌── RAG infrastructure
T2 ──────────┼── Data access / .NET integration
             ├── Calculation skill
             ├── Document generation adapter
             └── Leave-request adapter
```

After **T4**, legal/policy skills can proceed.

After **T5**, orchestrator/tool routing can proceed.

The **Gateway** should be integrated only after the orchestrator has a stable contract.

---

# 3. Ordered HacknPlan Stories & Tasks

# Story 3.1 — AI Service Foundation

## Task 3.1.1 — Create the AI Service Foundation

**Dependency:** None  
**Execution:** **BLOCKING — first task in the sprint**

### Goal

Create the standalone Node.js + Express service that will contain all AI functionality.

### Implement

- Express application
- Project structure
- Environment configuration
- Centralized error handling
- Request validation
- Logging
- Health check
- Modules for:
  - `orchestrator`
  - `skills`
  - `tools`
  - `rag`
  - `llm`
  - `data-access`
  - `integrations`
  - `config`

### Endpoint

`GET /health`

### Response

```json
{
  "status": "ok",
  "service": "wakeel-ai"
}
```

### Configuration

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

### Done when

- Service starts.
- `/health` returns 200.
- Missing required configuration fails clearly.
- Express routes do not contain AI business logic.

### Blocks

All other AI implementation tasks.

---

# Story 3.2 — Shared AI Contracts & Infrastructure

## Task 3.2.1 — Define AI Context, Response, Skill and Tool Contracts

**Dependency:** 3.1.1  
**Execution:** **BLOCKING**

### Goal

Create the contracts that every later AI module uses.

### AI Context

```ts
{
  userId: string;
  companyId: string;
  role: string;
  conversationId: string;
}
```

### Skill interface

```ts
interface AISkill {
  name: string;
  description: string;
  inputSchema: unknown;
  execute(input: unknown, context: AIContext): Promise<SkillResult>;
}
```

### Skill result

```ts
{
  success: boolean;
  data?: unknown;
  message?: string;
  sources?: Source[];
  action?: Action;
}
```

### Chat response

```ts
{
  conversationId: string;
  message: string;
  type: "text" | "action";
  sources: Source[];
  actions: Action[];
}
```

### Done when

All later skills/tools can import these contracts instead of defining their own shapes.

### Blocks

- Orchestrator
- Agent configuration
- Gateway final integration
- Skill registry

---

## Task 3.2.2 — Configure LLM and Embedding Providers

**Dependency:** 3.1.1  
**Execution:** **PARALLEL with 3.2.1**

### Implement

Create provider adapters/configuration for:

- Chat LLM
- Embedding model

Do not hard-code provider-specific calls inside skills.

### Done when

The rest of the application can call a common interface such as:

```ts
llm.generate(...)
embeddings.embedQuery(...)
embeddings.embedDocuments(...)
```

### Blocks

- RAG retrieval
- Agent/orchestrator integration

---

# Story 3.3 — Data Access & .NET Integration Layer

## Task 3.3.1 — Implement AI Data Access Layer

**Dependency:** 3.2.1  
**Execution:** **BLOCKING for context-based skills**

### Goal

Create one controlled layer for retrieving employee/company data required by AI.

### Services

```text
EmployeeContextService
CompanyContextService
```

### Employee input

```json
{
  "user_id": "uuid",
  "company_id": "uuid"
}
```

### Employee output

```json
{
  "user_id": "uuid",
  "company_id": "uuid",
  "full_name": "Ahmed Ali",
  "role": "Employee",
  "department": "Engineering",
  "employment_status": "Active",
  "leave_balance": {
    "annual": 12,
    "used": 5,
    "remaining": 7
  }
}
```

### Company input

```json
{
  "company_id": "uuid"
}
```

### Company output

```json
{
  "company_id": "uuid",
  "name": "Company Name",
  "industry": "Technology",
  "working_hours": "09:00-17:00",
  "policy_available": true
}
```

### Important

Inspect the real backend repository/Swagger and map the actual schema. Do not invent database fields or endpoints.

### Blocks

- Employee context skill
- Leave request flow
- Document generation context

---

## Task 3.3.2 — Implement .NET Integration Adapter

**Dependency:** 3.2.1  
**Execution:** **PARALLEL with 3.3.1**

### Goal

Create a reusable HTTP client for business operations owned by .NET.

### Required integrations

At minimum:

- Leave request creation
- Document/business operation integration if the current backend exposes it
- Any other mutation required by Sprint 3

### Rules

For every integration:

1. Inspect Swagger.
2. Inspect backend repository if needed.
3. Use exact method/path.
4. Use exact DTO.
5. Use exact response shape.
6. Use required authentication.
7. Do not duplicate .NET business logic.

### Blocks

- Leave Request Tool final integration
- Document Generation final integration

---

# Story 3.4 — RAG & Vector Knowledge Layer

## Task 3.4.1 — Configure MongoDB Vector Search

**Dependency:** 3.2.2  
**Execution:** **PARALLEL with Story 3.3**

### Goal

Create the MongoDB vector storage and Atlas Vector Search configuration.

### Vector document

```json
{
  "company_id": "uuid|null",
  "knowledge_type": "labor_law",
  "title": "Egyptian Labor Law",
  "content": "chunk text...",
  "embedding": [0.123, 0.456],
  "metadata": {
    "page": 12,
    "section": "Annual Leave",
    "source": "Egyptian Labor Law"
  }
}
```

### Required filters

```text
knowledge_type
company_id
```

### Isolation

Company policy retrieval must always filter by the authenticated company.

### Blocks

- Knowledge retrieval service
- Labor law skill
- Company policy skill

---

## Task 3.4.2 — Implement Knowledge Ingestion Endpoint

**Dependency:** 3.4.1 + 3.2.2  
**Execution:** **BLOCKING for knowledge retrieval**

### Endpoint

`POST /api/knowledge/ingest`

### Request

Multipart form data:

```text
file: <PDF/DOCX/TXT>
type: labor_law | company_policy
company_id: uuid
title: string
```

Rules:

- `labor_law`: company ID optional/null.
- `company_policy`: company ID required.

### Pipeline

```text
Upload
→ Text extraction
→ Normalization
→ Chunking
→ Embeddings
→ MongoDB vector storage
```

### Response

```json
{
  "knowledge_id": "uuid",
  "chunks_created": 42,
  "status": "completed"
}
```

### Blocks

- Knowledge retrieval testing
- RAG skills

---

## Task 3.4.3 — Implement Knowledge Retrieval Service

**Dependency:** 3.4.1 + 3.2.2  
**Execution:** **PARALLEL with 3.4.2 if the storage contract is already fixed; Done is blocked by 3.4.2 integration test**

### Input

```ts
{
  query: string;
  companyId: string;
  knowledgeTypes: ["labor_law" | "company_policy"];
  topK?: number;
}
```

### Output

```json
{
  "results": [
    {
      "content": "retrieved text...",
      "score": 0.92,
      "metadata": {
        "title": "Egyptian Labor Law",
        "section": "Annual Leave",
        "page": 12,
        "knowledge_type": "labor_law"
      }
    }
  ]
}
```

### Implement

- Query embedding
- MongoDB vector search
- Metadata filtering
- Company isolation
- Top-K selection
- Source metadata preservation

### Blocks

- LaborLawSkill
- CompanyPolicySkill

---

# Story 3.5 — Deterministic & Business Skills

## Task 3.5.1 — Implement CalculationService

**Dependency:** 3.2.1  
**Execution:** **PARALLEL with RAG and Data Access**

### Goal

Create deterministic calculations used by the AI.

### Operations

At minimum:

- Date difference
- Leave-day calculation
- Remaining leave balance
- Other basic HR calculations required by Sprint 3

### Input

```json
{
  "operation": "date_difference",
  "parameters": {
    "start_date": "2026-08-10",
    "end_date": "2026-08-15"
  }
}
```

### Output

```json
{
  "operation": "date_difference",
  "result": 6,
  "unit": "days"
}
```

### Rule

LLM decides **that** a calculation is needed; this service performs the actual calculation.

### Blocks

- Calculation tool registration
- End-to-end calculation flow

---

## Task 3.5.2 — Implement DocumentGenerationService

**Dependency:** 3.3.1 + 3.3.2  
**Execution:** **PARALLEL with 3.5.1**

### Goal

Generate supported HR documents from structured data.

### Input

```json
{
  "document_type": "employment_contract",
  "company_id": "uuid",
  "employee_id": "uuid",
  "data": {
    "employee_name": "Ahmed Ali",
    "job_title": "Software Engineer",
    "salary": 15000,
    "contract_type": "Full-time",
    "hire_date": "2026-08-10"
  }
}
```

### Processing

1. Validate document type.
2. Retrieve missing context.
3. Build structured data.
4. Select template.
5. Generate document.
6. Return document reference.
7. If .NET owns document generation, use the .NET endpoint instead of duplicating it.

### Output

```json
{
  "success": true,
  "document_id": "uuid",
  "document_url": "https://...",
  "document_type": "employment_contract"
}
```

### Blocks

- Document generation tool registration
- Document generation end-to-end flow

---

## Task 3.5.3 — Implement LeaveRequestTool

**Dependency:** 3.3.1 + 3.3.2 + 3.5.1  
**Execution:** **BLOCKING for leave-request end-to-end flow**

### Input

```json
{
  "user_id": "uuid",
  "company_id": "uuid",
  "leave_type": "annual",
  "start_date": "2026-08-10",
  "end_date": "2026-08-12",
  "reason": "Personal reasons"
}
```

### Processing

1. Validate user/company context.
2. Validate dates.
3. Retrieve leave balance if needed.
4. Calculate requested days.
5. Validate balance/business constraints available to AI.
6. Call existing .NET leave API.
7. Return created request.

### .NET contract

Must be taken from current Swagger/backend repository.

### Output

```json
{
  "success": true,
  "request_id": "uuid",
  "status": "Pending",
  "days_requested": 3
}
```

### Missing data

If dates/type are missing, the agent must ask the user rather than invent them.

---

# Story 3.6 — RAG Skills & Agent Orchestration

## Task 3.6.1 — Implement LaborLawSkill

**Dependency:** 3.4.3 + 3.2.1  
**Execution:** **PARALLEL with 3.6.2**

### Input

```ts
{
  question: string;
  companyId: string;
}
```

### Processing

- Search only `labor_law`.
- Retrieve relevant chunks.
- Pass retrieved context to LLM.
- Generate grounded answer.
- Return sources.

### Output

```json
{
  "answer": "According to the applicable labor law...",
  "sources": [
    {
      "title": "Egyptian Labor Law",
      "section": "Annual Leave",
      "page": 12,
      "score": 0.92
    }
  ]
}
```

---

## Task 3.6.2 — Implement CompanyPolicySkill

**Dependency:** 3.4.3 + 3.2.1  
**Execution:** **PARALLEL with 3.6.1**

### Input

```ts
{
  question: string;
  companyId: string;
}
```

### Processing

- Search only `company_policy`.
- Always apply current `companyId`.
- Return source metadata.
- Never invent a policy if no policy exists.

### Output

```json
{
  "answer": "According to your company's policy...",
  "sources": [
    {
      "title": "Company Leave Policy",
      "section": "Annual Leave",
      "page": 4,
      "score": 0.89
    }
  ]
}
```

---

## Task 3.6.3 — Create Skill/Tool Registry

**Dependency:** 3.2.1 + completed interfaces for the skills  
**Execution:** **INTEGRATION BLOCKER**

### Register

```text
calculation
employee_context
company_context
labor_law_search
company_policy_search
document_generation
leave_request
```

### Rule

Every tool must define:

- name
- description
- input schema
- output schema
- when to use
- restrictions
- whether it mutates data

### Blocks

- Final LangChain agent configuration

---

## Task 3.6.4 — Implement OrchestratorService

**Dependency:** 3.6.3 + core skill implementations  
**Execution:** **BLOCKING**

### Input

```ts
{
  conversationId: string;
  message: string;
  user: {
    id: string;
    companyId: string;
    role: string;
  };
}
```

### Output

```ts
{
  response: string;
  type: "text" | "action";
  sources: Source[];
  actions: Action[];
}
```

### Required routing

```text
document request      → document_generation
calculation           → calculation
employee question     → employee_context
labor-law question    → labor_law_search
company policy        → company_policy_search
leave request         → leave_request
```

### Multi-tool example

```text
"Can I take 5 days starting next Monday?"
        ↓
employee_context
        +
calculation
        +
leave_request
```

### Important

The orchestrator coordinates skills; it must not duplicate their business logic.

---

# Story 3.7 — LangChain Agent, Gateway & Security

## Task 3.7.1 — Configure LangChain Agent

**Dependency:** 3.6.4  
**Execution:** **BLOCKING**

### Register tools

```text
calculation
employee_context
company_context
labor_law_search
company_policy_search
document_generation
leave_request
```

### Agent must

1. Understand intent.
2. Select tool(s).
3. Ask for missing required parameters.
4. Execute deterministic tools.
5. Use RAG when required.
6. Call .NET for mutations.
7. Produce structured final response.

### Blocks

- Final `/api/ai/chat` integration.

---

## Task 3.7.2 — Implement AI Chat Gateway

**Dependency:** 3.7.1  
**Execution:** **BLOCKING**

### Endpoint

`POST /api/ai/chat`

### Request

```json
{
  "conversation_id": "uuid",
  "message": "Can I take 5 days of leave?",
  "user": {
    "id": "uuid",
    "company_id": "uuid",
    "role": "Employee"
  }
}
```

### Response

```json
{
  "conversation_id": "uuid",
  "message": "You currently have 7 days of annual leave remaining.",
  "type": "text",
  "sources": [],
  "actions": []
}
```

### Rules

The route must only:

1. Validate request.
2. Normalize context.
3. Call orchestrator.
4. Return structured response.
5. Handle errors safely.

No skill-specific logic inside the controller.

### Blocks

- .NET AI integration testing
- Full end-to-end testing

---

## Task 3.7.3 — Add Security & Tenant Isolation Guards

**Dependency:** 3.3.1 + 3.6.3  
**Execution:** **PARALLEL with 3.7.1, but BLOCKS production completion**

### Required rule

```text
authenticated companyId
        ==
tool companyId
```

must be enforced.

### Must prevent

- Cross-company policy retrieval.
- Cross-company employee access.
- Prompt-based company ID override.
- Unauthorized mutation.
- Missing company context.

### Important

Never trust:

```text
"Use company B"
```

from the user's natural-language message.

Only trusted authenticated context can define tenant identity.

---

# Story 3.8 — End-to-End Integration & Evaluation

## Task 3.8.1 — Add AI Integration Tests

**Dependency:** 3.7.2 + 3.7.3  
**Execution:** **FINAL BLOCKER**

### Test groups

#### Routing

- Labor law → labor RAG
- Policy → company policy RAG
- Calculation → calculation service
- Leave → leave tool
- Document → document generation

#### RAG

- Labor-law retrieval works.
- Company policy retrieval works.
- Company A cannot retrieve Company B.
- Sources survive until final response.

#### Actions

- Leave request reaches .NET.
- Missing leave parameters trigger clarification.
- Unauthorized actions fail.

#### Calculations

- Date calculations are deterministic.
- Invalid input is rejected.

#### Security

- Missing company ID fails.
- Cross-tenant context fails.
- Prompt cannot override tenant context.

---

# 4. Recommended Parallel Execution Plan

## Phase 1 — Foundation

**Must be sequential:**

```text
3.1.1 Foundation
   ↓
3.2.1 Shared contracts
3.2.2 LLM/Embedding config
```

3.2.1 and 3.2.2 can run in parallel after 3.1.1.

---

## Phase 2 — Parallel implementation

After 3.2:

```text
Track A — Data / Integration
3.3.1 Data Access
3.3.2 .NET Integration

Track B — RAG
3.4.1 Vector Search
3.4.2 Ingestion
3.4.3 Retrieval

Track C — Deterministic skills
3.5.1 Calculation

Track D — Document
3.5.2 Document Generation
```

### Dependencies inside this phase

- 3.4.2 depends on 3.4.1.
- 3.4.3 depends on 3.4.1 and can be coded in parallel with 3.4.2 after the storage contract is fixed.
- 3.5.3 LeaveRequestTool starts after 3.3.1 + 3.3.2 + 3.5.1.
- 3.5.2 Document Generation can run in parallel with Calculation.

---

## Phase 3 — Skills & orchestration

After the required Phase 2 components exist:

```text
3.6.1 LaborLawSkill  ─┐
3.6.2 CompanyPolicy   ├── parallel
3.6.3 Tool Registry   ┘
          ↓
3.6.4 Orchestrator
```

The orchestrator should not be marked Done until the tool contracts and core tools it routes to are available.

---

## Phase 4 — Agent & Gateway

Strict order:

```text
3.6.4 Orchestrator
      ↓
3.7.1 LangChain Agent
      ↓
3.7.2 /api/ai/chat
```

Security work can happen in parallel, but production completion is blocked by it:

```text
3.7.3 Security Guards
        ↓
3.8.1 Final Integration Tests
```

---

# 5. HacknPlan Dependency Summary

| Task | Dependency | Can Run In Parallel? | Blocks |
|---|---|---|---|
| 3.1.1 Foundation | None | No | Everything |
| 3.2.1 Contracts | 3.1.1 | With 3.2.2 | Orchestrator/skills |
| 3.2.2 LLM/Embeddings | 3.1.1 | With 3.2.1 | RAG/agent |
| 3.3.1 Data Access | 3.2.1 | With RAG | Context skills |
| 3.3.2 .NET Adapter | 3.2.1 | With Data Access | Leave/document integration |
| 3.4.1 Vector Search | 3.2.2 | With Data Access | RAG |
| 3.4.2 Ingestion | 3.4.1 | Yes, after schema/index | Knowledge availability |
| 3.4.3 Retrieval | 3.4.1 | With ingestion | RAG skills |
| 3.5.1 Calculation | 3.2.1 | Yes | Leave/tool routing |
| 3.5.2 Document | 3.3.1 + 3.3.2 | Yes | Document tool |
| 3.5.3 Leave Tool | 3.3.1 + 3.3.2 + 3.5.1 | After deps | Leave flow |
| 3.6.1 Labor RAG | 3.4.3 | With policy skill | Agent |
| 3.6.2 Policy RAG | 3.4.3 | With labor skill | Agent |
| 3.6.3 Tool Registry | Contracts + tool interfaces | Yes | Agent |
| 3.6.4 Orchestrator | Core tools + registry | No | Agent |
| 3.7.1 LangChain Agent | 3.6.4 | No | Gateway |
| 3.7.2 AI Gateway | 3.7.1 | No | E2E |
| 3.7.3 Security | Context + registry | With Agent | Production |
| 3.8.1 Tests | Gateway + Security | No | Sprint completion |

---

# 6. What The Team Should Put In HacknPlan

Each HacknPlan task should contain these fields:

```text
Title
Objective
Dependencies
Parallelization status
Endpoint / Internal Service
Input
Output
Implementation details
Configuration
Backend integration requirements
Validation
Security rules
Acceptance criteria
Tests
```

The **Dependencies** field should explicitly say:

```text
BLOCKS: Task X, Task Y
DEPENDS ON: Task A
CAN RUN IN PARALLEL WITH: Task B, Task C
```

This prevents a team member from starting an integration task before its required contract/infrastructure exists.

---

# 7. Definition of Done

Sprint 3 AI is complete only when:

- AI service is deployed and reachable.
- `.NET → AI → .NET` flow works.
- `/api/ai/chat` is operational.
- Orchestrator routes all required intents.
- Labor law RAG works.
- Company policy RAG works with tenant isolation.
- Employee/company context works.
- Calculations are deterministic.
- Document generation works through the agreed owner (.NET or AI service).
- Leave requests can be initiated through the AI.
- RAG responses include source metadata.
- Security/tenant guards are enforced.
- Critical end-to-end tests pass.

---

# 8. Important Note For The Team

**Do not treat the numeric task order as cosmetic.**

The order is the recommended implementation sequence. A developer may start a task early only when its dependency section explicitly says **PARALLEL** or **SOFT DEPENDENCY**.

If a task depends on a .NET endpoint whose contract is not yet finalized, mark it **INTEGRATION BLOCKER** rather than inventing the contract.



---

# Appendix — Original Detailed Implementation Notes

# Wakeel AI — Sprint 3 AI Backlog
## Implementation-ready HacknPlan Specification

> **Scope:** AI team only.  
> Backend (.NET), Web, and Mobile tasks are intentionally excluded.
>
> **Goal:** Every task below is implementation-ready enough that a team member can copy the complete task into an AI coding IDE and ask it to implement the task without having to redesign the architecture first.

---

# Sprint 3 — AI Layer

## Architecture

```text
Web / Mobile
     |
     v
.NET Wakeel API
     |
     |  AI request + authenticated user/company context
     v
Node.js + Express AI Service
     |
     v
AI Orchestrator
     |
     +--> RAG Search
     |      +--> Egyptian Labor Law
     |      +--> Company Policy
     |
     +--> Employee/Company Context
     |
     +--> Calculation Skill
     |
     +--> Document Generation Skill
     |
     +--> Leave Request Tool
     |
     v
LLM Response
     |
     v
.NET API
     |
     v
Web / Mobile
```

### Technology decisions

- AI service: **Node.js + Express**
- AI framework: **LangChain**
- LLM: use the provider/model configured by the project; do not hard-code a provider into business logic.
- Vector database: **MongoDB / MongoDB Atlas Vector Search**
- Main Wakeel business data remains owned by the .NET backend.
- The AI service may read the required employee/company data from the database through a controlled data-access layer.
- Actions that change business data must call the existing .NET APIs instead of writing directly to business collections.
- The AI service must be tenant-aware: every company-scoped operation must carry and validate `companyId`.
- The orchestrator decides which skill/tool is required.
- The LLM must not perform deterministic HR calculations itself.
- RAG responses must return source metadata so the final answer can cite the retrieved source.

---

# Story 3.1 — AI Service Foundation & AI Gateway

## Task 3.1.1 — Create the AI Service foundation

### Objective

Create the standalone Node.js + Express service that will contain the complete AI layer.

### Implementation

Create the service with:

- Express application
- TypeScript if the existing AI reference project uses TypeScript; otherwise preserve the reference project's language conventions.
- Environment configuration
- Centralized error handling
- Request validation
- Logging
- Health check
- Modular architecture for:
  - `orchestrator`
  - `skills`
  - `tools`
  - `rag`
  - `llm`
  - `data-access`
  - `integrations`
  - `config`

### Endpoint

`GET /health`

### Request

No request body.

### Response

```json
{
  "status": "ok",
  "service": "wakeel-ai"
}
```

### Configuration

Add environment variables for:

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

Do not expose secrets in source code.

### Acceptance criteria

- Service starts successfully.
- `/health` returns HTTP 200.
- Invalid/missing required configuration fails clearly at startup.
- AI modules are isolated from Express route definitions.

---

## Task 3.1.2 — Implement the AI chat gateway endpoint

### Objective

Create the single endpoint that .NET will call to execute an AI request.

### Endpoint

`POST /api/ai/chat`

### Request

```json
{
  "conversation_id": "uuid",
  "message": "Can I take 5 days of leave?",
  "user": {
    "id": "uuid",
    "company_id": "uuid",
    "role": "Employee"
  }
}
```

### Required fields

- `conversation_id`
- `message`
- `user.id`
- `user.company_id`
- `user.role`

### Response

```json
{
  "conversation_id": "uuid",
  "message": "You currently have 7 days of annual leave remaining.",
  "type": "text",
  "sources": [],
  "actions": []
}
```

### `sources`

```json
[
  {
    "source_id": "uuid",
    "title": "Egyptian Labor Law",
    "type": "labor_law",
    "section": "Annual Leave",
    "relevance": 0.91
  }
]
```

### `actions`

```json
[
  {
    "type": "leave_request",
    "status": "completed",
    "request_id": "uuid"
  }
]
```

### Implementation

The endpoint must:

1. Validate the request.
2. Validate/normalize user context.
3. Pass the request to the orchestrator.
4. Never contain skill-specific business logic.
5. Return the orchestrator's structured result.
6. Return controlled errors instead of raw stack traces.

---

# Story 3.2 — AI Orchestrator & Skill Routing

## Task 3.2.1 — Implement the AI orchestrator

### Objective

Create the central service responsible for deciding what the user's request requires.

### Internal service

`OrchestratorService`

### Input

```ts
{
  conversationId: string;
  message: string;
  user: {
    id: string;
    companyId: string;
    role: string;
  };
}
```

### Output

```ts
{
  response: string;
  type: "text" | "action";
  sources: Source[];
  actions: Action[];
}
```

### Skills/tools that must be routable

- `calculation`
- `document_generation`
- `employee_context`
- `labor_law_rag`
- `company_policy_rag`
- `leave_request`

### Required behavior

Examples:

```text
"What is my remaining leave?"
        -> employee_context

"How many days between 10 May and 18 May?"
        -> calculation

"Create an employment contract for Ahmed."
        -> document_generation

"Is this allowed under Egyptian labor law?"
        -> labor_law_rag

"What is our company's remote work policy?"
        -> company_policy_rag

"Submit a leave request from 10/08 to 12/08."
        -> leave_request
```

The orchestrator must be able to use more than one tool when necessary.

Example:

```text
"Can I take 5 days starting next Monday?"
```

Possible flow:

```text
employee_context
       +
calculation
       +
leave_request
```

### Important rule

The orchestrator must not directly implement the business logic of each skill. It only decides and coordinates.

---

## Task 3.2.2 — Create skill/tool contracts and registry

### Objective

Create a standard interface so every AI skill can be registered and invoked consistently.

### Internal interface

```ts
interface AISkill {
  name: string;
  description: string;
  inputSchema: unknown;
  execute(input: unknown, context: AIContext): Promise<SkillResult>;
}
```

### `AIContext`

```ts
{
  userId: string;
  companyId: string;
  role: string;
  conversationId: string;
}
```

### Skill result

```ts
{
  success: boolean;
  data?: unknown;
  message?: string;
  sources?: Source[];
  action?: Action;
}
```

### Registry

Create:

```ts
SkillRegistry
```

It must register and expose the six required skills/tools.

---

# Story 3.3 — RAG Knowledge Base

## Task 3.3.1 — Create knowledge ingestion endpoint

### Objective

Create an endpoint that accepts a legal/policy document, extracts its text, chunks it, creates embeddings, and stores the vectors in MongoDB.

### Endpoint

`POST /api/knowledge/ingest`

### Request

Use multipart form data:

```text
file: <PDF/DOCX/TXT>
type: labor_law | company_policy
company_id: uuid
title: string
```

For `labor_law`, `company_id` may be omitted/null.

For `company_policy`, `company_id` is required.

### Processing pipeline

```text
Upload
  ->
Text extraction
  ->
Document normalization
  ->
Chunking
  ->
Embedding generation
  ->
MongoDB vector document
```

### Vector document

```json
{
  "company_id": "uuid|null",
  "knowledge_type": "labor_law",
  "title": "Egyptian Labor Law",
  "content": "chunk text...",
  "embedding": [0.123, 0.456],
  "metadata": {
    "page": 12,
    "section": "Annual Leave",
    "source": "Egyptian Labor Law"
  }
}
```

### Response

```json
{
  "knowledge_id": "uuid",
  "chunks_created": 42,
  "status": "completed"
}
```

---

## Task 3.3.2 — Configure MongoDB Vector Search

### Objective

Create the MongoDB collection/schema and Atlas Vector Search configuration used by RAG.

### Configuration

Create/configure the vector index with:

- embedding field
- vector dimensions matching the selected embedding model
- cosine similarity
- metadata fields required for filtering

### Required metadata filters

The search layer must support:

```text
knowledge_type
company_id
```

### Isolation rules

For `company_policy`:

```text
company_id == current user's companyId
```

must always be applied.

Company A must never retrieve Company B's policy chunks.

Labor law is global and can be retrieved without a company-specific filter.

---

## Task 3.3.3 — Implement the knowledge retrieval service

### Internal service

`KnowledgeRetrievalService`

### Input

```ts
{
  query: string;
  companyId: string;
  knowledgeTypes: ["labor_law" | "company_policy"];
  topK?: number;
}
```

### Output

```json
{
  "results": [
    {
      "content": "retrieved text...",
      "score": 0.92,
      "metadata": {
        "title": "Egyptian Labor Law",
        "section": "Annual Leave",
        "page": 12,
        "knowledge_type": "labor_law"
      }
    }
  ]
}
```

### Behavior

- Generate embedding for the query.
- Run MongoDB vector search.
- Apply company isolation.
- Return top relevant chunks.
- Preserve metadata for citations.
- Do not send the entire knowledge base to the LLM.

---

# Story 3.4 — Employee & Company Context Tools

## Task 3.4.1 — Implement employee context service

### Objective

Allow the AI to retrieve information about the authenticated employee when the user's request requires it.

### Internal service

`EmployeeContextService`

### Input

```ts
{
  userId: string;
  companyId: string;
}
```

### Required returned data

```json
{
  "user_id": "uuid",
  "company_id": "uuid",
  "full_name": "Ahmed Ali",
  "role": "Employee",
  "department": "Engineering",
  "employment_status": "Active",
  "leave_balance": {
    "annual": 12,
    "used": 5,
    "remaining": 7
  }
}
```

### Rules

- Never accept a different `companyId` from the authenticated context.
- Do not return unrelated employee records.
- Return only fields required by the AI task.

### Data access

Use the appropriate existing database/API access method from the project's backend contract/reference code. Do not invent database schema fields if the actual backend uses different names.

---

## Task 3.4.2 — Implement company context service

### Internal service

`CompanyContextService`

### Input

```ts
{
  companyId: string;
}
```

### Output

```json
{
  "company_id": "uuid",
  "name": "Company Name",
  "industry": "Technology",
  "working_hours": "09:00-17:00",
  "policy_available": true
}
```

### Purpose

This service supplies company-level context to the orchestrator and document generation skill.

---

# Story 3.5 — Calculation Skill

## Task 3.5.1 — Implement deterministic calculation skill

### Objective

Create a non-LLM calculation service for calculations that the AI may request.

### Internal service

`CalculationService`

### Supported operations

At minimum:

- date difference
- number of leave days
- remaining leave balance
- basic HR quantity calculations required by the current sprint

### Input

```json
{
  "operation": "date_difference",
  "parameters": {
    "start_date": "2026-08-10",
    "end_date": "2026-08-15"
  }
}
```

### Output

```json
{
  "operation": "date_difference",
  "result": 6,
  "unit": "days"
}
```

### Important rule

The LLM may decide that a calculation is required, but the actual arithmetic must be executed by this deterministic service.

### Validation

Reject:

- invalid dates
- unsupported operations
- malformed parameters

---

# Story 3.6 — Document Generation Skill

## Task 3.6.1 — Implement document generation tool

### Objective

Allow the AI to generate supported HR documents using structured data.

### Internal service

`DocumentGenerationService`

### Input

```json
{
  "document_type": "employment_contract",
  "company_id": "uuid",
  "employee_id": "uuid",
  "data": {
    "employee_name": "Ahmed Ali",
    "job_title": "Software Engineer",
    "salary": 15000,
    "contract_type": "Full-time",
    "hire_date": "2026-08-10"
  }
}
```

### Processing

1. Validate document type.
2. Retrieve missing employee/company context.
3. Build structured document data.
4. Select the correct document template.
5. Generate the document.
6. Return the generated document reference.
7. If the system has a .NET document-generation endpoint, call it rather than duplicating business logic in the AI service.

### Output

```json
{
  "success": true,
  "document_id": "uuid",
  "document_url": "https://...",
  "document_type": "employment_contract"
}
```

### LLM rule

The LLM may populate structured fields, but the generated document must be produced through a deterministic template/document pipeline.

---

# Story 3.7 — Leave Request Tool

## Task 3.7.1 — Implement leave-request AI tool

### Objective

Allow an employee to request leave through natural language.

### Internal tool

`LeaveRequestTool`

### Input

```json
{
  "user_id": "uuid",
  "company_id": "uuid",
  "leave_type": "annual",
  "start_date": "2026-08-10",
  "end_date": "2026-08-12",
  "reason": "Personal reasons"
}
```

### Processing

1. Validate authenticated employee/company context.
2. Validate leave dates.
3. Retrieve leave balance if required.
4. Calculate requested days using `CalculationService`.
5. Validate required parameters.
6. Call the existing .NET leave-request API.
7. Return the created request.

### .NET integration request

The exact .NET endpoint/path/body must be taken from the current Swagger/backend repository. Do not invent it.

### Output

```json
{
  "success": true,
  "request_id": "uuid",
  "status": "Pending",
  "days_requested": 3
}
```

### Missing information behavior

If the user says:

```text
"I want to take leave next week."
```

the AI must ask for the missing required information instead of making up dates.

---

# Story 3.8 — Labor Law & Company Policy Skills

## Task 3.8.1 — Implement labor-law RAG skill

### Internal skill

`LaborLawSkill`

### Input

```ts
{
  question: string;
  companyId: string;
}
```

### Processing

1. Send the question to `KnowledgeRetrievalService`.
2. Restrict retrieval to `labor_law`.
3. Retrieve relevant chunks.
4. Provide chunks to the LLM.
5. Generate an answer grounded in retrieved content.
6. Return source metadata.

### Output

```json
{
  "answer": "According to the applicable labor law...",
  "sources": [
    {
      "title": "Egyptian Labor Law",
      "section": "Annual Leave",
      "page": 12,
      "score": 0.92
    }
  ]
}
```

The answer must not present unsupported legal claims as facts.

---

## Task 3.8.2 — Implement company-policy RAG skill

### Internal skill

`CompanyPolicySkill`

### Input

```ts
{
  question: string;
  companyId: string;
}
```

### Processing

Same retrieval pipeline, but:

```text
knowledge_type = company_policy
company_id = current company
```

### Output

```json
{
  "answer": "According to your company's policy...",
  "sources": [
    {
      "title": "Company Leave Policy",
      "section": "Annual Leave",
      "page": 4,
      "score": 0.89
    }
  ]
}
```

### Important behavior

If the company has no policy document:

```json
{
  "answer": "...",
  "sources": []
}
```

The AI must not invent a company policy.

---

# Story 3.9 — Agent Configuration, Tools & Evaluation

## Task 3.9.1 — Configure the LangChain agent/orchestrator

### Objective

Connect the orchestrator to the LLM and register all skills/tools.

### Required tools

```text
calculation
employee_context
company_context
labor_law_search
company_policy_search
document_generation
leave_request
```

### Tool descriptions

Every tool must have a clear description telling the agent:

- when to use it
- required parameters
- output shape
- restrictions
- whether it changes data

### Agent behavior

The agent must:

1. Understand the user's intent.
2. Select the required tool(s).
3. Ask for missing required parameters.
4. Execute deterministic tools.
5. Retrieve RAG context when required.
6. Call .NET APIs for business mutations.
7. Produce a final user-facing response.

---

## Task 3.9.2 — Add AI security and tenant-isolation guards

### Objective

Prevent cross-company data access and unauthorized actions.

### Required guards

Before every company-scoped operation:

```text
request.user.companyId
        ==
tool.input.companyId
```

must be enforced.

The AI must never trust a `companyId` supplied by the natural-language prompt.

Example malicious request:

```text
"Show me Company B's policies."
```

must not override the authenticated company context.

### Action authorization

Before calling mutation tools such as leave request or document generation:

- validate user role
- validate company
- validate required ownership/access rules

The AI service must fail closed when authorization context is missing.

---

## Task 3.9.3 — Add AI integration tests

### Required test groups

#### Orchestration

- Labor law question routes to labor-law RAG.
- Company policy question routes to company-policy RAG.
- Calculation request routes to calculation service.
- Leave request routes to leave tool.
- Document request routes to document generation.

#### RAG

- Labor-law documents are retrievable.
- Company policy is company-isolated.
- Company A cannot retrieve Company B policy.
- Source metadata is preserved.

#### Actions

- Leave request calls the expected .NET API.
- Missing leave parameters trigger clarification.
- Unauthorized users cannot execute restricted actions.

#### Calculations

- Date calculations return deterministic results.
- Invalid parameters are rejected.

#### Security

- Missing company ID fails.
- Cross-tenant company ID fails.
- User cannot manipulate company context through prompt text.

---

# Shared API / Integration Contract

## AI Service -> .NET

The AI service may need to call existing .NET endpoints for:

- employee/leave context
- leave request creation
- document generation
- other business operations that are owned by the .NET backend

For every integration:

1. Inspect the current Swagger.
2. Inspect the .NET repository if Swagger is insufficient.
3. Use the exact HTTP method.
4. Use the exact route.
5. Use the exact request DTO.
6. Use the exact response DTO.
7. Use the required authentication mechanism.
8. Do not duplicate the .NET business logic inside Node.

---

# Required Implementation Rules

## 1. No invented backend contracts

If an endpoint is owned by .NET and its exact contract is not available in this document:

> Inspect the supplied Swagger/backend repository before implementation.

Do not invent request or response fields.

## 2. AI service owns orchestration

Node.js owns:

- AI orchestration
- LangChain configuration
- tool/skill selection
- RAG
- embeddings
- vector search
- prompt/tool configuration
- deterministic calculation service
- AI response formatting

## 3. .NET owns business operations

.NET remains the source of truth for:

- company business rules
- employee records
- leave request persistence
- document business persistence
- authorization/business workflows already implemented there

## 4. MongoDB Vector Search

The vector database must support:

- semantic search
- labor-law retrieval
- company-policy retrieval
- company isolation
- source metadata

## 5. Every task must be testable

Each implementation must include appropriate unit/integration tests for the functionality introduced by the task.

---

# Suggested HacknPlan Structure

## Story 3.1 — AI Service Foundation & Gateway

- 3.1.1 Create AI Service Foundation
- 3.1.2 Implement `POST /api/ai/chat`

## Story 3.2 — Orchestration & Skills

- 3.2.1 Implement OrchestratorService
- 3.2.2 Create Skill/Tool Registry and Contracts

## Story 3.3 — RAG Knowledge Layer

- 3.3.1 Implement `POST /api/knowledge/ingest`
- 3.3.2 Configure MongoDB Vector Search
- 3.3.3 Implement KnowledgeRetrievalService

## Story 3.4 — Employee & Company Context

- 3.4.1 Implement EmployeeContextService
- 3.4.2 Implement CompanyContextService

## Story 3.5 — Calculations

- 3.5.1 Implement CalculationService

## Story 3.6 — Document Generation

- 3.6.1 Implement DocumentGenerationService

## Story 3.7 — Leave Requests

- 3.7.1 Implement LeaveRequestTool

## Story 3.8 — Legal & Policy Skills

- 3.8.1 Implement LaborLawSkill
- 3.8.2 Implement CompanyPolicySkill

## Story 3.9 — Agent, Security & Tests

- 3.9.1 Configure LangChain Agent and Tools
- 3.9.2 Add Security/Tenant Guards
- 3.9.3 Add AI Integration Tests

---

# Definition of Done — AI Sprint 3

The AI sprint is complete when:

- Node.js AI service is deployed and reachable by .NET.
- `.NET -> AI -> .NET` communication works.
- One unified `/api/ai/chat` endpoint handles the AI conversation flow.
- Orchestrator can route all required intents.
- Labor law is searchable through vector retrieval.
- Company policies are searchable with tenant isolation.
- Employee context can be retrieved.
- Calculations are performed deterministically.
- Document generation is available through the defined integration.
- Employees can submit leave requests through the AI.
- RAG responses provide source metadata.
- Unauthorized/cross-company access is blocked.
- Integration tests cover the complete critical path.
