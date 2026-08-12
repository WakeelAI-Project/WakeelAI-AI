# Wakeel AI Service Architecture Rulebook

This is the permanent architecture rulebook for the Wakeel AI Service. **All future AI coding agents and developers must follow this document when working on the repository.**

## 1. Project Purpose
The Wakeel AI Service is a standalone Node.js + Express application that handles all AI-specific functionalities (orchestration, LangChain integrations, vector search, tool execution, etc.) while the main .NET backend remains responsible for core business logic and mutations.

## 2. High-Level Architecture
```text
Web / Mobile -> .NET Wakeel API -> Node.js + Express AI Service
                                     |-> AI Gateway / Orchestrator
                                     |-> Skills & Tools
                                     |-> RAG / LLM Providers
```
- **Synchronous Express Execution:** The service uses standard HTTP request/response models.
- **NO WORKERS:** This architecture intentionally **DOES NOT USE** BullMQ, Redis workers, Celery, or background job queues. Keep deployment simple.

## 3. Folder Structure & Responsibilities

| Directory | Responsibility | What NOT to put here |
| --- | --- | --- |
| `src/config/` | Environment variables loading, configuration objects, validation. | Business logic, DB connections. |
| `src/contracts/` | Shared data structures (JSDoc `typedef`s) used by all modules. | Implementation logic. |
| `src/controllers/` | HTTP request handling, calling application logic, formatting HTTP responses. | **No LLM calls, no DB queries, no AI business logic.** |
| `src/data-access/` | MongoDB connection setup and infrastructure. | Vector collections, domain logic, Express objects. |
| `src/integrations/` | Communication with external services (e.g., .NET Wakeel API). | AI tools logic (this layer only handles HTTP calls). |
| `src/llm/` | LLM provider configuration, embeddings providers, model adapters. | Prompt execution logic or orchestration. |
| `src/middleware/` | Express middleware (auth, validation, error handling, logging). | Business logic. |
| `src/orchestrator/` | Intent understanding, skill/tool routing, context construction. | HTTP transport specifics (req/res). |
| `src/rag/` | Document ingestion, chunking, embeddings, vector storage/search. | General AI orchestration. |
| `src/routes/` | Express route definitions mapping HTTP paths to controllers. | Business logic, data transformations. |
| `src/shared/` | Cross-cutting infrastructure (e.g., logger). | Domain-specific utilities. |
| `src/skills/` | AI capabilities (calculations, document generation, RAG logic, HR tools). | Express transport, database access logic. |
| `src/tools/` | External executable tools (leave request API call via integrations). | Express routing. |

## 4. Rules for AI Coding Agents
Future AI coding agents must read this document and adhere to the following rules:

1. **NO TYPESCRIPT:** This project is strictly JavaScript (ES Modules). Do not add `.ts` files, `tsconfig.json`, or `@types/*` dependencies. Use JSDoc for types.
2. **NO NEW TOP-LEVEL FOLDERS:** Do not create random utility folders (e.g., `src/utils`, `src/helpers2`, `src/aiStuff`). Fit your code into the established structure.
3. **THIN CONTROLLERS:** Controllers only parse HTTP requests and format HTTP responses. They must delegate to services/orchestrators.
4. **NO DB IN CONTROLLERS:** Database access must go through `data-access`.
5. **NO LLM IN CONTROLLERS:** LLM interactions belong in `orchestrator`, `skills`, or `rag`.
6. **SHARED CONTRACTS:** Import shared contracts from `src/contracts/index.js` instead of duplicating structures across files.
7. **SYNCHRONOUS EXECUTION:** Do not introduce RabbitMQ, Redis, BullMQ, or Celery.
8. **ISOLATE TRANSPORT:** Skills, tools, and the orchestrator must not depend on Express `req` or `res` objects directly. Pass clean contextual data (e.g., `AIContext`).

## 5. Persistence and Ownership

### 5.1 AI Server Owns Chat History
Unlike general business data (which lives in the .NET Postgres database), **Chat History is owned exclusively by the AI Server** in its MongoDB database. 
The .NET backend acts as a gateway for history requests, but does not store the messages itself.

### 5.2 Tenant & User Isolation
All conversations and messages are strictly isolated by `companyId` and `userId`.
- The AI Server enforces ownership: it will reject any retrieval attempt where the requesting user/company does not match the owner of the conversation.
- Unauthorized access attempts safely return `404 Not Found` to prevent leaking the existence of other tenants' data.

### 5.3 Internal Request Headers (Service-to-Service)
The AI Server **never trusts identity context from query parameters or request bodies**. 
The .NET backend is the sole authority for authentication and authorization.

When communicating with the AI Server, the .NET backend must include the trusted identity using internal HTTP headers:
- `X-Internal-API-Key`: The shared internal secret (validates the request origin) verified against `WAKEEL_INTERNAL_API_KEY`.
- `X-User-Id`: The authenticated user's ID.
- `X-Company-Id`: The authenticated user's company ID.
- `X-Role`: The authenticated user's role.

### 5.4 Wakeel API Integrations (Context Retrieval)
The AI Server **does NOT own employee or company business data** (e.g., full name, leave balances, company name). 
When a skill requires context to answer a user's prompt, the AI Server makes synchronous HTTP requests back to the `.NET backend` to retrieve it.

**Context Retrieval Endpoints & Auth:**
- The AI Server authenticates its outbound request to `.NET` using the exact same headers (`X-Internal-API-Key`, `X-User-Id`, `X-Company-Id`, `X-Role`).
- **EmployeeContextService**: Calls `.NET` via `GET /api/ai/employee-context`
  - Expected backend response schema: `{ record_id, full_name, department, job_title, employment_status, leave_balance: { annual, sick, unpaid } }`
- **CompanyContextService**: Calls `.NET` via `GET /api/ai/company-context`
  - Expected backend response schema: `{ id, name, tax_id, industry, address, phone_number, email, logo_url, working_hours, registered_at }`

## 6. API Endpoint Inventory (Canonical Contracts)

### Internal AI Routes (Served by AI Server)
- **`POST /api/ai/chat`**: (requires `X-Internal-API-Key`, `X-User-Id`, `X-Company-Id`, `X-Role`)
  - Body: `{ message, conversationId }`
  - Response: `{ conversationId, message, type, sources, actions, missing_fields, result_card }`
- **`GET /api/ai/chat/history`**: (requires `X-Internal-API-Key`, `X-User-Id`, `X-Company-Id`, `X-Role`)
  - Query Parameters: `conversationId` (required), `page`, `limit`

### Knowledge Ingestion (Served by AI Server)
- **`POST /api/knowledge/ingest`**: (requires `X-Internal-API-Key`, `X-User-Id`, `X-Company-Id`, `X-Role` — `requireInternalAuth` is applied to this route)
  - Body Fields Include: `sourceType` (formerly `knowledgeType`), `companyId`, `documentId`, `title`, `content`.

### 6.1 `conversationId` Lifecycle (Finalized)
The AI Server **never generates** a `conversationId`. `.NET` owns generation:
1. Client starts a new conversation with no `conversation_id`.
2. `.NET` generates a new `conversationId` (UUID) and includes it in the `POST /api/ai/chat` body sent to the AI Server.
3. The AI Server persists messages under that exact `conversationId` and returns it unchanged in the response.
4. `.NET` returns the `conversationId` to the client (as `conversation_id`) so it can be reused on subsequent turns and passed to `GET /chat/history`.
5. History and ownership are always scoped by `conversationId + userId + companyId` (see `chat-history.repository.js:findConversation`).

The AI Server route schema enforces `conversationId` as a required, non-empty string on both `POST /api/ai/chat` and `GET /api/ai/chat/history` — a request without one is rejected with `400` before any orchestration happens.

## 7. Skill/Tool Architecture

### Skill Execution Lifecycle
The AI Server leverages an Orchestrator/SkillRegistry architecture (`src/orchestrator/dependency-boundaries.js`). 
- **Calculation Skill**: Evaluates mathematical intents deterministically and is isolated inside `src/skills/calculation/`. It relies on the orchestrator to fetch any context beforehand if needed, and uses LLM structured parsing only to identify operands.

## 8. Document Generation Architecture
*Document generation is a shared responsibility where the AI Server handles dynamic content assembly and the .NET Backend owns persistence and templating.*

### 8.1 Responsibility Boundary

**AI Server owns:**
- Intent/document-type identification
- Required-field detection & missing-field detection
- Conversational collection of missing values
- Template retrieval request (`GET /api/ai/templates/active?documentType={documentType}`)
- Company-context retrieval
- RAG retrieval when legal/policy grounding is required
- Document content generation & template placeholder filling
- Document save request (`POST /api/documents/save`) — see §10.3 for the finalized request/response contract
- Structured result response (`document_draft`)

**.NET Backend owns:**
- Template persistence, CRUD, activation, and versioning
- Document persistence (`GENERATED_DOCUMENT` storage)
- Document lifecycle (finalize, PDF generation, email/download)
- Authorization for persisted resources

### 8.2 Document Generation Flow

```text
HR -> .NET Backend -> AI Server -> Document Generation Skill
```
1. AI determines document type & required fields.
2. AI checks provided values.
3. If fields are missing, AI returns structured `missing_fields`.
4. HR provides field values.
5. AI Server retrieves Company Context, Active Document Template, and RAG context (if required).
6. AI generates document content.
7. AI posts to `.NET`: `POST /api/documents/save`.
8. `.NET` persists document as Draft.
9. AI receives `document_id`/`status`.
10. AI returns `document_draft` `result_card` to HR.

### 8.3 Important Constraints
- **NO Target Employee Lookup:** The AI Server must NOT interpret `X-User-Id` as a target employee ID for generating a document, nor perform name-based employee lookup. The required employee information is supplied directly by the HR through the structured missing-fields conversational flow. Employee Context is only retrieved if the existing business logic requires the requester's context.
- **Strict Error Handling:** If a template is not found or a save request fails, the AI Server safely returns a structured application error. It will not generate an invented contract or falsely report a document was saved.

## 9. Error Handling
AI Server internal errors use a structured format:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```
The `.NET` gateway must translate these into the final client-facing envelope. Secrets and stack traces are never exposed.

## 10. Formal Contracts (Schemas)

### 10.1 `missing_fields`
When the AI requires explicit input from the user (e.g., during document generation), it returns an array of:
```json
{
  "field_name": "contract_type",
  "input_type": "dropdown",
  "label": "Contract Type",
  "options": ["Full-time", "Part-time"]
}
```

### 10.2 `result_card`
The `result_card` returned in `ChatResponse` is a strictly typed discriminated union. The `type` field must be one of:
- `calculation` (e.g., end_of_service_gratuity)
- `document_draft` (returns `doc_id`, `doc_type`, `employee_name`)
- `leave_draft` (returns `request_id`, `leave_type`, `start_date`, `end_date`, `days_requested`, `actions`)

### 10.3 `POST /api/documents/save` Request (Finalized)
Enforced by `DocumentSaveRequestSchema` in `src/integrations/wakeel/document-api.js` (`.strict()` — no undeclared fields accepted). Identity (`userId`, `companyId`, `role`) is intentionally **not** duplicated here; it is already trusted from the internal headers.
```json
{
  "document_type": "Contract",
  "title": "Employment Contract - Ahmed",
  "content_html": "<p>...</p>",
  "employee_id": "uuid",
  "template_id": "uuid",
  "metadata": { "any": "additional structured data" }
}
```
| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `document_type` | string | yes | Matches the `document_type` used to fetch the active template. |
| `title` | string | yes | Human-readable document title. |
| `content_html` | string | yes | Fully rendered document content as HTML. |
| `employee_id` | string | yes | The **target** employee the document is about — never the caller's identity. |
| `template_id` | string | no | The template used to generate this document, when applicable. |
| `metadata` | object | no | Free-form structured data (e.g. filled placeholder values). Never used to carry identity. |

Response (`DocumentSaveResponseSchema`, unchanged and already finalized):
```json
{ "success": true, "document_id": "uuid", "document_type": "Contract", "status": "Draft", "created_at": "2026-08-12T10:30:00Z" }
```

## 11. Known Unresolved Contracts
*None. All previous integration gaps (`result_card`, `missing_fields`, `POST /api/documents/save` request/response, `conversationId` lifecycle, and template-fetch schemas) are now canonicalized within the AI Server. Both previously-identified implementation bugs (unauthenticated `/api/knowledge/ingest`, and the `executeWakeelRequest`/`wakeelFetch` export mismatch in `template-api.js`/`document-api.js`) have been fixed and covered by tests.*
