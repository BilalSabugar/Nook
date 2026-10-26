# Nook Project Roadmap 🗺️

This document outlines the planned milestones, upcoming features, and architectural evolution for **Nook**.

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

## 📍 Version 1.1.0 — Real Container Supervisor & Sandboxing
- [ ] **Docker Daemon Integration**: Run agent terminal commands inside real lightweight Alpine/Ubuntu containers via Docker socket.
- [ ] **Headless Chromium / Playwright Remote**: Full interactive web browser streaming via WebRTC/VNC into the computer modal.
- [ ] **Multi-Agent Cross-Mentions**: Automatic multi-coworker handoffs in the chat timeline (e.g. `@Scout` passes extracted research directly to `@Quill` to write a Space page).
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
