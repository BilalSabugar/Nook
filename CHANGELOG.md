# Changelog 📜

All notable changes to **Nook** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-26

### Added
- **Persistent AI Coworkers**: 4 specialized agents (`Scout`, `Quill`, `Cipher`, `Aura`) with customizable system prompts, assigned tools, and persistent status.
- **Agent Computers**: Isolated sandboxes with live Web Scraper (`/api/sandbox/browse`), Bash command runner with safety sandbox policies (`/api/sandbox/exec`), and `/workspace` virtual filesystem editor.
- **Living Spaces**: Collaborative document workspace with Editor, Preview, and Raw Markdown modes, word & character counters, and `.md` file export.
- **Slash Command Palette**: Interactive palette (`/h1`, `/h2`, `/task`, `/code`, `/quote`, `/table`, `/ask`) accessible via `/ Blocks`.
- **Model Context Protocol (MCP)**: JSON-RPC 2.0 compliant server route (`/api/mcp`) implementing `tools/list` and `tools/call` for `web_search`, `fetch_url`, `calculate`, and `format_document`.
- **Human-in-the-Loop Review Cards**: Unified diff preview and quick decline reason chips for approving/declining document saves and shell executions.
- **Voice Sessions**: Real-time simulated audio call with reactive waveforms, spoken captions, and a picture-in-picture mini-player.
- **Multi-Provider Intelligence**: Built-in support for Google Gemini, OpenAI GPT-4o, Anthropic Claude 3.5, and local Ollama, alongside an autonomous zero-key simulation fallback.
- **Monochrome Minimalist UI**: High-contrast, black-and-white aesthetic inspired by ChatGPT dots and CopilotKit OpenDots.
- **Unit Test Suite**: Built-in Node test runner verifying agents, spaces, MCP schemas, sandbox security policies, and document utilities.
