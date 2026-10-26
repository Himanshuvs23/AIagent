# AI Task Agent V2 — Production-Grade Architecture

## Vision
A local-first autonomous computer/work agent that can understand a user's goal, create and execute a multi-step plan, use built-in tools and MCP servers, delegate work to specialist agents/subgraphs, modify local files/code, run projects, observe a live browser/computer, verify results, recover from failures, and request human approval for high-impact actions.

## V2 Product Principles
1. Local-first and privacy-aware.
2. Agentic execution, not just chat completion.
3. Tool/MCP/agent capabilities are dynamically discoverable.
4. Every meaningful action is observable and auditable.
5. High-risk actions require explicit approval.
6. Workspace isolation and sandboxing are mandatory.
7. The agent must verify its own work before declaring success.
8. The system should support many employee roles through capability packs rather than one giant prompt.

## Core Architecture

User/UI
  -> Intent + Task Classifier
  -> Task Orchestrator / Supervisor
  -> Planner
  -> Capability Discovery
      -> Built-in Tools
      -> MCP Registry
      -> Specialist Agents
      -> Subgraphs/Workflows
  -> Execution Runtime
      -> File/Code Workspace
      -> Shell Sandbox
      -> Browser Runtime
      -> Computer Use Runtime
      -> API/HTTP
      -> Documents/Notes
  -> Observation + State
  -> Verification / Critic
  -> Recovery / Retry
  -> Approval Gate when required
  -> Final result + artifacts + audit trail

## Major V2 Modules

### 1. Workspace & Project Manager
- Create/open/clone projects.
- Detect project type and stack.
- Maintain per-project context.
- File tree, search, diff, history and rollback.
- Git branch/commit/diff integration.
- Environment/configuration discovery without exposing secrets.

### 2. Live Browser
- Embedded browser inside the agent application.
- Browser sessions tied to a task.
- DOM/accessibility-tree inspection.
- Screenshot and visual observation.
- Console/network/error capture.
- Click/type/scroll/navigation/download/upload.
- Live page updates streamed to UI.
- Browser devtools-style console/log panel.
- Local development URL support.
- Automatic verification after code changes.

### 3. Live Code-to-Browser Loop
Example: "Build a login page."
1. Inspect project.
2. Edit source files.
3. Start/restart dev server.
4. Detect local URL.
5. Open URL in embedded browser.
6. Inspect rendered result.
7. Capture errors/screenshot.
8. Fix code.
9. Re-run tests/build.
10. Repeat until acceptance criteria pass.

### 4. Computer Control Layer
- Filesystem operations.
- Process/service management.
- Terminal/shell.
- Window/application awareness where supported.
- Clipboard.
- Browser/computer interaction.
- Notifications.
- Archive/PDF/document operations.
- OS-level actions behind permission policies.

### 5. Tool Registry
All capabilities are registered with:
- name
- description
- input/output schema
- permissions
- risk level
- required secrets
- supported roles
- availability/health
- timeout/retry policy
- provenance/version

### 6. MCP Gateway
- MCP server registry.
- Discover/list tools and resources.
- Start/stop/reconnect MCP servers.
- Health checks.
- Per-server permissions.
- Tool allow/deny policies.
- Context filtering.
- Audit every MCP invocation.
- Support local and remote MCP servers with explicit trust levels.

### 7. Agent System
Use a supervisor + specialist architecture.

Supervisor Agent:
- Understands goal.
- Chooses capability pack.
- Creates high-level plan.
- Delegates subtasks.
- Tracks dependencies and completion.

Specialists:
- Software Engineer Agent
- Research Agent
- Data Analyst Agent
- Documentation/Writer Agent
- Project Manager Agent
- Office/Admin Agent
- Browser/Computer Agent
- QA/Test Agent
- DevOps Agent
- Finance/Spreadsheet Agent
- Customer Support Agent
- Marketing Agent
- HR/Recruiting Agent

Specialists should be reusable subgraphs rather than independent uncontrolled agents.

### 8. Subgraph / Workflow Engine
Reusable workflows such as:
- research -> summarize -> notes
- requirement -> implementation -> test -> browser verification
- CSV -> profile -> analysis -> charts -> report
- email -> classify -> draft -> approval -> send
- meeting notes -> action items -> task creation
- document -> extract -> validate -> transform -> export

### 9. Role Capability Packs
Instead of hardcoding every profession into the supervisor, define capability packs.

Developer: IDE, Git, shell, browser, package manager, tests, Docker, API testing, docs.
Data Analyst: CSV/Excel, SQL, Python, notebooks, charts, reports.
Researcher: web search, browser, PDFs, citations, notes.
Writer: documents, research, editing, formatting, publishing.
Project Manager: tasks, calendar, email, docs, status reports.
Sales/Marketing: CRM, email, research, spreadsheets, content.
HR: resumes, candidate comparison, scheduling, email, documents.
Finance/Admin: spreadsheets, invoices, documents, reconciliation with approval controls.

### 10. Self-Management
The agent can manage its own project/runtime through controlled commands:
- inspect status
- install approved dependency
- create/update configuration
- start/stop/restart service
- register tool/MCP
- enable/disable capability
- run diagnostics
- inspect logs
- create migration
- update workflow definition
- run tests
- create git branch/commit
- rollback its changes

Self-modification must operate in a separate control plane with policy checks and audit logs.

### 11. Memory System
Three layers:
- Working memory: current task state.
- Episodic memory: previous tasks/results.
- Semantic memory: durable user/project facts.

Add memory policies for TTL, confidence, provenance, deletion and user visibility.

### 12. RAG / Knowledge Layer
- Project-code indexing.
- Local document indexing.
- Semantic + lexical retrieval.
- Metadata filtering.
- Reranking.
- Citation/provenance.
- Incremental indexing after file changes.

### 13. Verification System
Never trust a successful tool call as proof of success.
Verification examples:
- code -> tests/build/lint
- UI -> browser screenshot/DOM/console
- API -> response/schema/assertions
- document -> file existence/content validation
- research -> source/citation checks

### 14. Reliability
- Durable task state.
- Checkpointing.
- Idempotency keys.
- Timeouts.
- Retries with backoff.
- Fallback models/tools.
- Circuit breakers.
- Dead-letter/failed-task queue.
- Resume interrupted tasks.

### 15. Human-in-the-Loop
Approval levels:
LOW: read-only/local analysis.
MEDIUM: file edits, dependency installation, local process changes.
HIGH: email/send, publish, delete, financial/legal action, external account mutation.
CRITICAL: destructive OS/system/security operations.

Approval UI should show exact action, target, reason, affected files/resources and proposed parameters.

### 16. Security
- Tool permission model.
- Workspace sandbox.
- Command allow/deny policies.
- Secret isolation.
- Prompt-injection detection.
- Untrusted-content boundary.
- Browser origin/domain policies.
- MCP trust levels.
- SSRF protections.
- File path traversal protection.
- Rate limits.
- Audit logs.
- Kill switch.

### 17. Observability
Per task show:
- current plan
- active agent/subgraph
- tool call
- arguments summary
- duration
- result
- retry count
- tokens/cost
- errors
- approval events
- verification result

Store structured traces for debugging and evaluation.

### 18. Notes / Knowledge Workspace
User example: "Research X and make notes."
Agent should:
1. Search/research.
2. Gather sources.
3. Produce structured notes.
4. Create a note/project artifact.
5. Open it in the built-in editor.
6. Allow user/agent edits.
7. Preserve version history.

### 19. Artifact System
First-class artifacts:
- code files
- markdown notes
- PDFs
- spreadsheets
- presentations
- images
- datasets
- reports
- test results
- browser screenshots

Every artifact should have provenance and task association.

### 20. Task Queue & Background Agents
- Foreground interactive tasks.
- Background tasks.
- Scheduled tasks.
- Recurring workflows.
- Resume after restart.
- Notifications when blocked/completed.

## Suggested V2 Repository Structure

apps/
  desktop/                 # Tauri/Electron shell + UI
  web/                     # React application UI
services/
  api/                     # API gateway
  orchestrator/            # supervisor + task lifecycle
  runtime/                 # execution sandbox
  browser/                 # embedded browser controller
  mcp-gateway/             # MCP discovery/security
  memory/                  # memory + retrieval
  indexer/                 # project/document indexing
packages/
  agents/
  subgraphs/
  tools/
  schemas/
  policy/
  prompts/
  observability/
  shared/
workspaces/
  # user/project workspaces, isolated from application source
mcp/
  servers/
configs/
  roles/
  policies/
docs/
  architecture/
  security/
  adr/
tests/
  unit/
  integration/
  agent-evals/

## Recommended Technology Direction

Frontend/Desktop: React + TypeScript + Tauri (preferred for a local-first desktop product).
Backend: Python for agent/orchestration services, with FastAPI where an HTTP boundary is useful.
Agent orchestration: LangGraph-style stateful graphs/subgraphs.
Browser: Playwright + Chromium.
MCP: MCP-compatible gateway/registry.
Database: PostgreSQL for durable state + SQLite for lightweight local metadata where appropriate.
Cache/queue: Redis.
Vector search: pgvector initially; optional local vector store later.
Observability: OpenTelemetry + LangSmith-compatible tracing or an equivalent local trace store.
Sandbox: isolated workspace/process/container execution depending on OS.
Git: native Git CLI/library integration.

## Initial Built-in Tool Families (target 40+ capabilities)

Filesystem: list/read/write/edit/move/copy/delete/search/diff/watch.
Code: syntax/check/lint/test/build/format/refactor/search-symbols.
Shell: execute/stream/logs/process-start/process-stop/process-restart.
Browser: navigate/click/type/scroll/screenshot/dom/console/network/download/upload.
Git: status/diff/branch/commit/checkout/log/revert.
HTTP: request/download/API test.
Documents: PDF extract/create, Markdown, DOCX, XLSX, PPTX.
Data: CSV/Excel analysis, SQL query, chart/report generation.
Notes: create/search/update/tag/link/version.
System: diagnostics, environment info, service status, notifications.

## Development Phases

Phase 0 — Foundation
- Monorepo structure.
- Shared schemas.
- Task state model.
- Permissions/policy engine.
- Structured logging.

Phase 1 — Local Developer Agent
- Workspace manager.
- File/code tools.
- Shell sandbox.
- Git tools.
- Test/build loop.

Phase 2 — Live Browser
- Embedded Chromium.
- Browser control.
- Local dev server discovery.
- Code -> browser -> observe -> fix loop.

Phase 3 — MCP + Dynamic Capabilities
- MCP gateway.
- Registry.
- Dynamic discovery.
- Trust/permission policies.

Phase 4 — Multi-Agent/Subgraphs
- Supervisor.
- Specialist agents.
- Reusable subgraphs.
- Parallel execution with dependency control.

Phase 5 — Universal Employee Capability Packs
- Developer.
- Data analyst.
- Researcher.
- Writer.
- PM.
- HR.
- Marketing/sales.
- Admin/finance.

Phase 6 — Computer Use + Self Management
- Computer runtime.
- Process/app control.
- Agent diagnostics.
- Controlled self-management.

Phase 7 — Production Reliability & Security
- Durable execution.
- Checkpoints.
- Recovery.
- Sandboxing.
- Prompt-injection defenses.
- Secret isolation.
- Audit trail.

Phase 8 — Evaluation
Build an agent benchmark covering task completion, tool selection, recovery, security, browser success, hallucination rate, latency, cost and human approval accuracy.

## MVP Definition of Done

A user can say:
"Create a new React dashboard project, add authentication, run it locally, open it in the built-in browser, verify the login flow, fix any errors, create a README, commit the work, and show me the result."

The agent should autonomously plan and execute the task, use multiple tools/subgraphs, observe the live browser, recover from errors, request approval only where policy requires it, preserve checkpoints, and provide a complete execution trace and artifacts.

## North Star
The goal is not to create a chatbot with many tools. The goal is to create a **local autonomous work operating system** where agents, tools, MCP servers, workflows, memory, browser/computer control and project artifacts form one governed execution environment.
