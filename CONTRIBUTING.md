# Contributing to Nook 🏠

Thank you for your interest in contributing to **Nook**! We are building an open-source, persistent agent environment where human teams and autonomous AI coworkers collaborate across living documents, sandboxed computers, and real-time review safeguards.

---

## 🧭 Code of Conduct
By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 🛠️ Local Development Setup

### Prerequisites
- **Node.js**: v18.18.0 or later (v20+ or v24 recommended)
- **npm**: v9 or later (or pnpm/yarn/bun)
- **Git**

### Installation Steps

1. **Fork and Clone the Repository**:
   ```bash
   git clone https://github.com/<your-username>/Nook.git
   cd Nook
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   ```bash
   cp .env.example .env.local
   ```
   *(Optional: Add your Gemini, OpenAI, Anthropic, or Ollama keys. Nook functions immediately in Autonomous Demo Mode without any API keys).*

4. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) (or whichever port is assigned) in your browser.

5. **Run Typecheck & Build**:
   ```bash
   npm run build
   ```

---

## 📐 Project Structure

```text
Nook/
├── src/
│   ├── app/                 # Next.js App Router (pages, layout, API routes)
│   │   ├── api/             # Backend server endpoints (chat, sandbox, health)
│   │   ├── layout.tsx       # Root layout & themes
│   │   └── page.tsx         # Main interactive workspace
│   ├── components/          # Reusable UI components
│   │   ├── navigation/      # Sidebar and Space/Agent switchers
│   │   ├── chat/            # Real-time agent chat, thought traces & review cards
│   │   ├── spaces/          # Living document editor & library
│   │   ├── computer/        # Agent Computer (Browser, Terminal, Files, Takeover)
│   │   ├── review/          # Human-in-the-loop approval cards
│   │   ├── tools/           # Model Context Protocol (MCP) tool registry
│   │   └── modals/          # Create Agent, Create Space, Settings modals
│   ├── lib/                 # Core engine services & data stores
│   │   ├── store.ts         # Initial state, persistence & seed data
│   │   └── llm-service.ts   # Multi-provider LLM executor & agent engine
│   └── types/               # TypeScript type definitions
└── public/                  # Static assets
```

---

## 💡 How to Contribute

### 1. Adding a New Persistent Coworker Archetype
Agents are defined in `src/types/index.ts` and initialized in `src/lib/store.ts`. When creating a new coworker:
- Choose a distinct avatar icon and color palette.
- Define explicit `allowedTools` (e.g., `['tool-web-search', 'tool-save-page']`).
- Provide focused system instructions describing their domain of expertise.

### 2. Extending MCP Tools
MCP tools are defined in `INITIAL_MCP_TOOLS` within `src/lib/store.ts`:
- Specify `requiresApproval: true` for any mutating actions (e.g. file writing, shell execution, database mutations).
- Specify `requiresApproval: false` for read-only actions (e.g. web search, file reading).

### 3. Improving Document Editor Capabilities
The document editor in `src/components/spaces/SpaceWorkspace.tsx` supports visual editing and raw Markdown mode with slash commands. Feel free to contribute additional formatting blocks, rich media embeds, or export options!

---

## 🚢 Pull Request Workflow

1. Create a descriptive feature branch:
   ```bash
   git checkout -b feat/add-custom-mcp-connector
   ```
2. Commit your changes with clear messages adhering to [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation updates
   - `refactor:` code restructuring
3. Ensure the project builds cleanly:
   ```bash
   npm run build
   ```
4. Push your branch and open a Pull Request against `main`.

---

## 💬 Community & Discussions
Have questions or ideas? Open an issue or join GitHub Discussions to shape the future of autonomous coworkers!
