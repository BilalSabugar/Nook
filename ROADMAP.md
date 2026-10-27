# Nook Project Roadmap 🗺️

This document outlines the planned milestones, upcoming features, and architectural evolution for **Nook**.

> **Note on Methodology**: Nook is developed via agile **vibe coding** — pairing creative human direction with agentic AI pairing to rapidly architect, test, and harden autonomous coworker capabilities.

---

## 📍 Version 1.0.0 (Current Release) — The Foundation
- [x] **Specialist AI Coworkers**: Scout (Research), Quill (Docs), Cipher (DevOps), and Aura (Strategy).
- [x] **Agent Computers**: Isolated sandboxes with live Web Scraper, Terminal command executor, and virtual `/workspace` file tree.
- [x] **Collaborative Living Spaces**: Notion/Linear-style document canvas with Editor, Preview, and Raw Markdown modes, plus `/ Blocks` slash command palette.
- [x] **Human-in-the-Loop Review Cards**: Interactive approval gates before modifying Spaces or running mutating shell commands.
- [x] **Model Context Protocol (MCP)**: JSON-RPC 2.0 compliant server (`/api/mcp`) supporting standard `tools/list` and `tools/call`.
- [x] **Multi-Provider Intelligence Router**: Zero-key autonomous demo simulation alongside Google Gemini, OpenAI, Anthropic Claude, and local Ollama.
- [x] **Voice Sessions**: Real-time simulated audio call with reactive waveforms and picture-in-picture mini-player.
- [x] **Monochrome Minimalist UI**: High-contrast, black-and-white design inspired by ChatGPT dots and CopilotKit OpenDots.

---

## 📍 Version 1.2.0 (Current Release) — Autonomous Missions & Evidence Engine
- [x] **Aura Multi-Agent Orchestrator**: Objective decomposition, milestone dependency trees, and task delegation across Scout, Quill, and Cipher.
- [x] **Persistent Missions System**: Durable multi-session objectives tracked in transactional SQLite with status lifecycles and recovery.
- [x] **Immutable Evidence Engine**: Verifiable timeline with tool calls, source citations, command exit codes, and output artifacts.
- [x] **Sovereign Local Self-Hostability**: Zero-cloud deployment support with local Ollama runners and complete workspace export/import.
- [x] **Extensible Plugin Framework**: Typed manifests, JSON-RPC tools, per-agent permissions, and health checks.
- [x] **Knowledge Workspace Full-Text Search**: Instant search across spaces, documents, excerpts, and tags.
- [x] **Competitive Benchmark Harness**: Reproducible comparative evaluation vs CopilotKit OpenDots & OpenBot (`benchmarks/nook-vs-opendots/`).
- [x] **Verified Real-World Demonstrations**: Automated end-to-end test scenarios covering research, engineering, multi-agent synthesis, and worker recovery.

---

## 📍 Version 1.3.0 — Real Container Supervisor & Sandboxing
- [ ] **Docker Daemon Integration**: Run agent terminal commands inside real lightweight Alpine/Ubuntu containers via Docker socket.
- [ ] **Headless Chromium / Playwright Remote**: Full interactive web browser streaming via WebRTC/VNC into the computer modal.
- [ ] **Git Integration in Workspace**: Direct branch creation, staging, and commit generation inside `/workspace`.

---

## 📍 Version 1.2.0 — Extended Integrations & Bridges
- [ ] **Slack & Discord Bot Bridges**: Chat with your Nook coworkers directly from team messaging channels.
- [ ] **GitHub App Webhook Integration**: Coworkers automatically review Pull Requests and comment summaries.
- [ ] **Local Vector Store (RAG)**: Semantic vector indexing over all Living Spaces for long-term agent contextual memory.
- [ ] **Speech-to-Text & Real TTS**: Web Audio API Whisper STT and elevenlabs/EdgeTTS voice streaming for voice calls.

---

## 📍 Version 2.0.0 — Enterprise Team Workspaces
- [ ] **Multi-User Real-time Sync**: Operational transformation / CRDT (Yjs) for live collaborative document editing.
- [ ] **Role-Based Access Control (RBAC)**: Fine-grained permissions for executing shell commands and approving high-stakes changes.
- [ ] **Self-Hosted Airgapped Deployment**: Complete Helm chart and Docker Compose bundle for on-premise Kubernetes clusters.

---

## 💡 Submitting Ideas
Have an idea or feature request? Please open a discussion or file a feature request using our [Issue Templates](https://github.com/BilalSabugar/Nook/issues/new/choose).
