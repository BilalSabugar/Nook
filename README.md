# Nook 🏠⚡

> **Your Autonomous AI Coworker Sanctuary** — Persistent AI agents with dedicated sandboxed computers, collaborative Spaces, and human-in-the-loop review safeguards.

Inspired by [CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots), built with **Next.js 15 (App Router)**, **TypeScript**, and **Tailwind CSS**.

---

## 🌟 Key Architectural Pillars

### 1. 🤖 Persistent Specialist Coworkers ("Nooks")
Instead of ephemeral disposable chat threads, Nook provides persistent specialist coworkers with customized roles, system instructions, and tool permission boundaries:
- **Scout** 🧭 *(Research & Deep Web Navigator)*: Navigates websites, extracts documentation, and synthesizes intelligence.
- **Quill** ✍️ *(Lead Technical Writer & Document Architect)*: Turns bullet points and code into polished Spaces documentation.
- **Cipher** ⚡ *(DevOps & Code Engineer)*: Runs terminal commands, tests pipelines, and inspects files in the container sandbox.
- **Aura** 👑 *(Executive Strategist)*: Coordinates cross-space initiatives and synthesizes roadmaps.

### 2. 💻 Agent Computers & Sandboxes
Each coworker is equipped with an isolated virtual computer:
- **Interactive Browser Viewport**: View web pages navigated by agents, with address bar controls and an instant **Human Takeover Mode** to click and browse alongside the agent.
- **Interactive Bash Terminal**: Live execution console with stdout, stderr, exit codes, and interactive user shell input.
- **Virtual Workspace Filesystem (`/workspace`)**: File tree, code viewer, and syntax inspection for persistent agent files.
- **Activity Stream**: Chronological audit trail of all agent actions.

### 3. 📑 Collaborative Spaces & Document Editor
- **Living Document Canvas**: Visual editor with quick formatting (H1, H2, Code blocks, Task checkboxes, Quote callouts), raw markdown mode, and autosave with revision counters.
- **Document Library**: Switch between responsive Grid and List views with search and tagging.
- **Page Chat Drawer**: Ask an assigned specialist coworker to review, add sections to, or refine any document in the Space.

### 4. 🛡️ Human-in-the-Loop Review Cards
High-stakes actions (such as saving new pages to Spaces or executing shell commands in the sandbox) trigger interactive **Review Cards** directly in the chat timeline:
- **Approve & Save**: Creates or updates the page in the Space and triggers celebratory feedback.
- **Approve & Run**: Executes the bash command in the agent's computer sandbox.
- **Decline**: Requests revisions and passes feedback back to the agent.

### 5. 🔌 Model Context Protocol (MCP) & Extensible Tools
- Modular tool registry with permission toggles (*Requires Review* vs *Autonomous Run*).
- Support for connecting custom MCP servers (Web search, PostgreSQL, GitHub, custom APIs).

### 6. 🧠 Multi-Provider Intelligence
- **Autonomous Demo Engine**: Runs out of the box with realistic multi-step thoughts, tool invocations, and review cards (zero API keys required).
- **Direct Provider Support**: Easily configure **Google Gemini**, **OpenAI**, **Anthropic**, or **Local Ollama** in the in-app Settings dialog.

---

## 🚀 Getting Started

### Prerequisites
- Node.js `v18+` or `v20+` (Tested on Node `v24`)
- npm `v9+`

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/your-username/nook.git
cd nook

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or `http://localhost:3001` if port 3000 is occupied) in your browser.

---

## 🏗️ Project Structure

```text
Nook/
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout with dark theme & typography
│   │   ├── page.tsx           # Primary workspace coordinator
│   │   └── globals.css        # Tailwind styles & theme variables
│   ├── components/
│   │   ├── navigation/
│   │   │   └── Sidebar.tsx    # Spaces & Coworkers navigation
│   │   ├── chat/
│   │   │   └── AgentChat.tsx  # Reasoning timeline & chat stream
│   │   ├── computer/
│   │   │   └── NookComputer.tsx # Browser, Terminal, Files & Takeover
│   │   ├── spaces/
│   │   │   └── SpaceWorkspace.tsx # Rich visual editor & document library
│   │   ├── review/
│   │   │   └── ReviewCard.tsx # Interactive approve/decline cards
│   │   ├── tools/
│   │   │   └── McpManager.tsx # MCP connections & tool permissions
│   │   └── modals/
│   │       ├── AgentModal.tsx # Create custom persistent agents
│   │       ├── SpaceModal.tsx # Create collaborative project spaces
│   │       └── SettingsModal.tsx # Multi-provider LLM credentials
│   ├── lib/
│   │   ├── store.ts           # Pre-configured seed data & initial state
│   │   └── llm-service.ts     # Multi-provider LLM executor & agent engine
│   └── types/
│       └── index.ts           # Comprehensive TypeScript interfaces
├── next.config.ts             # Next.js configuration
├── package.json               # Dependencies and scripts
└── tsconfig.json              # TypeScript configuration
```

---

## 📄 License
MIT License. Open-source for all developers and teams building the future of autonomous coworkers.
