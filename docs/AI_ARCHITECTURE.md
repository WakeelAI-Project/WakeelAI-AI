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

## 5. Future Module Map (For AI Agents)
- When building a new skill (e.g., Calculation Skill), put it in `src/skills/calculation/`.
- When integrating with the Leave API, create the HTTP client in `src/integrations/wakeel/` and expose it via a tool in `src/tools/leave-request/`.
- When implementing RAG ingestion, put the logic in `src/rag/ingestion/`.
- When configuring LangChain models, put them in `src/llm/`.
