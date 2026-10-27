# Changelog 📜

All notable changes to **Nook** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-10-27

### Phase 2: Multi-Agent Missions, Evidence Engine & Competitive Parity
- **Aura Central Orchestrator & Task Delegation**:
  - Implemented multi-agent task planning, milestone decomposition, and dependency scheduling in `@/lib/orchestrator.ts`.
  - Autonomous task delegation across specialist personas: Scout (Research & Citations), Quill (Living Space Documentation), and Cipher (Isolated Execution & Testing).
  - Deterministic stepping engine (`/api/missions`) executing one milestone per tick with output artifact verification.
- **Persistent Missions Engine**:
  - Added SQLite schema for persistent missions and agent tasks with milestones, status lifecycles, and priority management.
  - Multi-session mission recovery surviving application and worker restarts.
- **Immutable Evidence Engine & Verification Layer**:
  - Unified inspectable task timeline recording tool calls, source citations, execution exit codes, and output artifacts.
  - Secret redaction preventing sensitive environment variables from leaking into audit logs.
  - Verification checks for research citations, code test suites, and file integrity.
  - Redacted Markdown audit report export (`/api/missions/evidence?format=markdown`).
- **Sovereign Local Self-Hostability & Portability**:
  - Comprehensive zero-cloud local deployment guide with local Ollama model integration (`docs/deployment/SELF_HOSTED_GUIDE.md`).
  - Full workspace export and import API (`/api/workspace/export` and `/api/workspace/import`), safely serializing spaces, documents, revisions, missions, and evidence while stripping secret credentials.
- **Plugin & Extension Architecture**:
  - Extensible plugin system (`@/lib/plugins.ts`) supporting JSON-RPC tools, per-agent permissions, typed schemas, and execution timeouts.
  - Built-in GitHub repository inspector and document structure analyzer plugins.
  - Developer plugin creation guide with security best practices (`docs/plugins/DEVELOPER_GUIDE.md`).
- **Knowledge Workspace Search**:
  - Instant SQLite full-text search across living spaces, documents, titles, excerpts, and tags (`/api/workspace/search`).
- **Competitive Benchmark & Verification Harness**:
  - Executable comparative benchmark suite (`benchmarks/nook-vs-opendots/run-benchmark.mjs`) evaluating multi-agent orchestration, permission bypass resistance, SSRF defense, and document revision throughput (100% pass rate).
  - Executable real-world end-to-end demonstrations (`docs/demonstrations/run-demonstrations.mjs`) covering autonomous research, sandbox testing, multi-agent collaboration, and persistent worker crash recovery (100% pass rate).
  - Exhaustive competitive audit vs CopilotKit OpenDots & OpenBot (`docs/competitive/OPENDOTS_COMPARISON.md`).
- **User Interface Integration**:
  - Dedicated Mission Dashboard (`MissionDashboard.tsx`) with goal decomposition forms, milestone progress bars, interactive task observation logs, and evidence inspection cards.
  - Integrated into main sidebar and ⌘K command palette.

---

## [1.1.0] - 2026-10-27

### Security Remediation & Architecture Upgrades
- **Authentication System**:
  - Removed arbitrary-token acceptance and Host header bypasses.
  - Implemented cryptographic HMAC-SHA256 session token generation and verification.
  - Added single-user session bootstrap (`/api/auth/session`) issuing `HttpOnly`, `SameSite=Lax` cookies.
  - Added strict CSRF validation on mutating requests using session cookies.
  - Implemented in-memory sliding-window rate limiting (120 reqs/min) and 5MB payload limits.
- **Server Approvals & Replay Protection**:
  - Migrated approvals to transactional SQLite database (`.nook_storage/nook.db`).
  - Enforced mandatory single-use authorization token and exact command/agent matching.
  - Redacted reusable approval tokens in general GET listings (`/api/approvals`).
  - Atomic status transitions (`pending` -> `approved` -> `consumed`).
- **Filesystem & Execution Sandboxing**:
  - Required valid server approvals for shell command execution (`/api/sandbox/exec`).
  - Added path traversal prevention (`../` and absolute paths blocked) in file synchronization.
  - Stripped host environment secrets and API keys from child process execution environments.
  - Enforced 10-second timeout and 512KB output buffer limits.
- **Centralized SSRF Defense Engine**:
  - Implemented `safeFetch` and `validateOutboundUrl` in `@/lib/ssrf`.
  - Blocked IPv4/IPv6 loopback, link-local, cloud metadata (`169.254.169.254`), and private networks.
  - Integrated SSRF checks into browser fetch and MCP `fetch_url`.
- **Encrypted Secrets Vault**:
  - Implemented AES-256-GCM encryption for stored API keys (`.nook_storage/secrets.enc`).
  - Added automatic migration from legacy plaintext `secrets.json`.
  - Enforced model whitelisting and local loopback restrictions for Ollama endpoints.
- **Durable Storage & Living Spaces**:
  - Built transactional SQLite engine using Node 24 native `node:sqlite`.
  - Added document versioning (`v1`...`vN`), immutable revision history, and rollback endpoints.
- **Autonomous Background Worker**:
  - Implemented worker engine with atomic job claiming, progress persistence, and cancellation support.
- **Testing & Tooling**:
  - Standardized on Node 24 across development, Dockerfile, and GitHub Actions CI.
  - Regenerated lockfile for Node 24 (`npm ci` clean with 0 vulnerabilities).
  - Added comprehensive security test suite (`src/__tests__/security-and-isolation.test.mjs`).

---

## [1.0.0] - 2026-10-26

### Added
- **Initial Prototype**: 4 specialist agents (`Scout`, `Quill`, `Cipher`, `Aura`).
- **Living Spaces**: Document canvas with editor, preview, and markdown modes.
- **MCP Protocol**: JSON-RPC 2.0 tool definitions.
- **UI System**: High-contrast minimalist desktop design with command palette (`⌘K`).
