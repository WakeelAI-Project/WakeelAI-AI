# Reference AI Stack Analysis

*Note: This document is based on the architectural direction provided in the Sprint 3 Hack'n Plan, rather than inspection of a physical legacy codebase. The architecture intentionally moves away from complex asynchronous workers in favor of a clean, synchronous Express REST API.*

## 1. Technologies Recommended & Selected
- **Runtime:** Node.js
- **Web Framework:** Express.js (Synchronous execution)
- **Language:** JavaScript (ES Modules, strict typing via JSDoc)
- **Validation:** Zod (for environment variables and HTTP requests)
- **Database / Vector Search:** MongoDB + Mongoose (with MongoDB Atlas Vector Search anticipated for future tasks)
- **AI Framework:** LangChain (to be integrated in future tasks for LLM calls, Tools, and Agents)
- **Logging:** Winston (centralized, structured logging)

## 2. Technologies Explicitly Rejected
- **TypeScript:** Rejected in favor of plain JavaScript with JSDoc to avoid compilation steps and maintain simplicity.
- **Workers & Background Jobs:** BullMQ, Redis workers, Celery, RabbitMQ, and any background processing queues are **explicitly rejected**.
  - *Reasoning:* The current sprint prioritizes deployment simplicity. AI operations will be executed synchronously via HTTP requests. Introducing worker queues adds infrastructural overhead that is unnecessary for the foundational phase.

## 3. Future Architectural Direction
While LangChain, LLMs, and Vector databases are part of the target architecture, they are **deferred** to later tasks (e.g., Task 3.4 for RAG, Task 3.6 for orchestration). The current foundation establishes the modular boundaries (skills, tools, orchestrator, rag) to support these technologies when they are introduced without muddying the Express layer.
