# Changelog 📜

All notable changes to **Nook** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
