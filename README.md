# Wakeel AI — AI Orchestrator

[![CI](https://github.com/WakeelAI-Project/WakeelAI-AI/actions/workflows/ci.yaml/badge.svg)](https://github.com/WakeelAI-Project/WakeelAI-AI/actions/workflows/ci.yaml)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)

The Node.js AI orchestrator for **Wakeel AI**, an AI-assisted HR platform. It powers the chat assistant used in the [mobile app](https://github.com/WakeelAI-Project/WakeelAI-Mobile) and [HR dashboard](https://github.com/WakeelAI-Project/WakeelAI-Frontend): intent detection, retrieval-augmented answers over Egyptian labor law and each company's own policy handbook, deterministic calculations, HR document drafting, and leave-request tool-calling — all brokered through [WakeelAI-Backend](https://github.com/WakeelAI-Project/WakeelAI-Backend), which is the sole source of a caller's identity.

This is one of four repositories that make up the Wakeel AI system:

| Repo | Role |
| --- | --- |
| [WakeelAI-Mobile](https://github.com/WakeelAI-Project/WakeelAI-Mobile) | Employee-facing Flutter app |
| [WakeelAI-Frontend](https://github.com/WakeelAI-Project/WakeelAI-Frontend) | HR/admin web dashboard |
| [WakeelAI-Backend](https://github.com/WakeelAI-Project/WakeelAI-Backend) | ASP.NET Core API — auth, leave, employees, documents |
| **WakeelAI-AI** *(this repo)* | Node.js AI orchestrator — chat, RAG over labor law/company policy, leave/document tool-calling |

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [CI/CD](#cicd)
- [Contributing](#contributing)
- [Team](#team)

## Features

- **AI chat gateway** — a conversational endpoint with per-user, per-company conversation history persisted in MongoDB.
- **Intent-routed skills and tools** — an orchestrator classifies each message and dispatches it:
  - **Labor Law skill** — RAG-grounded Q&A over Egyptian Labor Law, jurisdiction-locked.
  - **Company Policy skill** — RAG-grounded Q&A over each company's own handbook, tenant-scoped by company.
  - **Calculation skill** — parses natural-language math into a structured operation and computes it deterministically — the LLM never does the arithmetic itself.
  - **Document Generation skill** — drafts HR documents (contracts, warning letters, termination letters) from the backend's active templates, with any AI-generated legal/policy clause strictly grounded in retrieved sources — it fails rather than fabricates when grounding is unavailable.
  - **Leave request tools** — create, submit, and cancel a leave draft through the backend's leave API.
- **Retrieval-augmented generation** — chunking, Hugging Face embeddings, and MongoDB Atlas Vector Search, with tenant-safe filtering (global labor law vs. company-scoped policy) and citation sources returned alongside every grounded answer.
- **Pluggable LLM provider** — a minimal adapter layer (an ITI-provided gateway or Groq, both OpenAI-compatible) selected via environment variable, so the model backing the assistant can be swapped without touching skill/tool logic.
- **Internal machine-to-machine auth** — every request is authenticated with a pre-shared key plus identity headers forwarded by the .NET backend; the AI service never accepts or trusts a user's JWT directly.

## Tech Stack

- **[Node.js](https://nodejs.org)** 20 / **[Express](https://expressjs.com)** 5 — ESM throughout
- **[MongoDB](https://www.mongodb.com)** (Mongoose) + **[Atlas Vector Search](https://www.mongodb.com/products/platform/atlas-vector-search)** — chat history and the RAG knowledge store
- **[@langchain/core](https://js.langchain.com)** — shared message/schema utilities (not used as an orchestration framework)
- **[Hugging Face Inference API](https://huggingface.co/docs/api-inference)** — embeddings (`BAAI/bge-m3`, 1024-dim)
- **[Zod](https://zod.dev)** — runtime validation for config, requests, and structured LLM output
- **[Winston](https://github.com/winstonjs/winston)** — logging
- **Jest** + **Supertest** — testing

## Architecture

Each chat message flows: **intent detection** (LLM, structured output) → **skill/tool registry lookup** → **capability execution** (RAG retrieval, deterministic calculation, backend tool call, or document drafting) → **final LLM response**, assembled with conversation history and any retrieved sources. The service is deliberately synchronous request/response — no background job queue — and integrates with [WakeelAI-Backend](https://github.com/WakeelAI-Project/WakeelAI-Backend) in both directions: the backend proxies user-facing chat requests in, and this service calls back out to fetch employee/company context and to create or submit leave requests and documents, always via identity headers the backend has already authenticated.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) `20`
- A MongoDB Atlas cluster with a Vector Search index created for the knowledge collection (see [`docs/KNOWLEDGE_VECTOR_INDEX.md`](docs/KNOWLEDGE_VECTOR_INDEX.md))
- API keys for the chosen LLM provider and for Hugging Face (embeddings)
- A running instance of [WakeelAI-Backend](https://github.com/WakeelAI-Project/WakeelAI-Backend), sharing the same internal API key

### Installation

```bash
git clone https://github.com/WakeelAI-Project/WakeelAI-AI.git
cd WakeelAI-AI
npm install
cp .env.example .env   # fill in the values described below
npm run dev
```

On startup the server connects to MongoDB and automatically bootstraps the bundled Egyptian labor-law PDF into the knowledge base if it isn't already ingested. Company policy documents are ingested at runtime via `POST /api/knowledge/ingest`, called by the backend.

## Configuration

All configuration is env-var driven and validated at startup with Zod — the process exits immediately if a required credential is missing (see [`.env.example`](.env.example) for the full template):

| Variable | Purpose | Required |
| --- | --- | --- |
| `MONGODB_URI` / `MONGODB_DB_NAME` | Atlas connection (chat history + vector search) | yes |
| `LLM_PROVIDER` | `iti` or `groq` | no (default `iti`) |
| `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` | LLM provider credentials/config | yes |
| `HUGGINGFACE_API_KEY` / `EMBEDDING_MODEL` | Embedding provider | yes |
| `WAKEEL_API_BASE_URL` | Base URL of the .NET backend | yes |
| `WAKEEL_INTERNAL_API_KEY` | Shared M2M secret with the backend | yes |
| `VECTOR_INDEX_NAME` | Atlas Vector Search index name | yes |
| `KNOWLEDGE_RETRIEVAL_TOP_K` / `KNOWLEDGE_CHUNK_SIZE` | RAG tuning | no |
| `INITIAL_LABOR_LAW_*` | Metadata for the bootstrapped labor-law document | yes |
| `PORT` / `NODE_ENV` | Server port and environment | no |

## Testing

```bash
npm test               # Jest, ~46 files covering every layer
npm run test:integration   # opt-in: exercises a real Atlas Vector Search index
node test-llm.js       # manual smoke test of LLM connectivity
```

`npm run test:integration` only runs when `RUN_INTEGRATION_TESTS=true` is set, since it hits a real MongoDB Atlas Vector Search index rather than a mock. `npm test` runs in CI on every pull request into `develop`.

## Project Structure

```
src/
├── app.js / server.js   # Express app + entry point (connects DB, bootstraps knowledge, listens)
├── config/               # Zod-validated environment config
├── contracts/             # Shared data contracts (AIContext, ChatResponse, Skill, Tool, Source...)
├── controllers/            # Thin HTTP handlers
├── data-access/             # Mongoose models, DB connection, repositories
├── integrations/wakeel/      # Outbound HTTP clients to the .NET backend
├── llm/                       # LLM provider adapters, embeddings client, provider factory
├── middleware/                 # Internal M2M auth, request validation, error handling
├── orchestrator/                 # Intent detection and skill/tool dispatch
├── rag/                            # Ingestion (chunking, PDF extraction), retrieval, vector index config
├── routes/                          # Express routers
├── services/                         # Application services (calculation, chat history, contexts,
│                                      #   document generation, leave requests)
├── skills/                            # Labor law, company policy, calculation, document generation
└── tools/                              # Leave draft create/submit/cancel
```

## CI/CD

**[`ci.yaml`](.github/workflows/ci.yaml)** runs on every pull request into `develop`: installs dependencies and runs the Jest test suite.

## Contributing

Branch off `develop` (not `main`) and name branches by what they do: `feature/<name>` for new functionality, `fix/<name>` for bug fixes, `docs/<name>` for documentation, `chore/<name>` for maintenance. Open a PR into `develop`; `main` is only updated by merging a ready `develop` for release.

## Team

Built by the Wakeel AI graduation team as an ITI AI Capstone project:

- Mohanad Tarek
- Ahmed Alaa
- [Assem Mohamed](https://github.com/Assem-Mohamed)
- [Hosam Abdullah](https://github.com/Hosam-Abdullah)
- Abdelrahman ElWarraky
- [Abdelrahman Ahmed Yasser](https://github.com/0Abdelrahman1)
