import type { Agent, Space, ComputerState, MCPTool, LLMSettings, Message, ReviewRequest } from '../types/index.ts';

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'agent-scout',
    name: 'Scout',
    avatar: '🧭',
    role: 'Research & Intelligence',
    description: 'Autonomous web investigator. Navigates real websites, extracts documentation, monitors competitors, and synthesizes deep briefs.',
    systemPrompt: 'You are Scout, an elite autonomous research agent. You browse websites, scrape structured data, cross-reference tech stacks, and generate crisp synthesis notes.',
    status: 'idle',
    statusMessage: 'Ready for deep-dive research',
    color: '#6366f1',
    allowedTools: ['tool-web-search', 'tool-web-browse', 'tool-save-file', 'tool-save-page'],
    assignedSpaces: ['space-research', 'space-launch'],
    computerEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'agent-quill',
    name: 'Quill',
    avatar: '✍️',
    role: 'Technical Writer',
    description: 'Product documentation architect. Transforms research transcripts, bullet points, and code repos into polished Spaces documents.',
    systemPrompt: 'You are Quill, a master technical writer and documentation specialist. You produce structured Markdown, clear release notes, RFCs, and API docs with immaculate typography.',
    status: 'idle',
    statusMessage: 'Ready to draft and revise documents',
    color: '#10b981',
    allowedTools: ['tool-save-page', 'tool-format-doc', 'tool-read-file'],
    assignedSpaces: ['space-launch', 'space-research'],
    computerEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'agent-cipher',
    name: 'Cipher',
    avatar: '⚡',
    role: 'DevOps & Engineer',
    description: 'Sandbox executor & developer. Runs terminal commands, tests API payloads, inspects container environments, and debugs code.',
    systemPrompt: 'You are Cipher, an expert software engineer and container operator. You test bash scripts, verify build pipelines, analyze repository files, and report terminal logs.',
    status: 'idle',
    statusMessage: 'Computer sandbox active & ready',
    color: '#f59e0b',
    allowedTools: ['tool-terminal-exec', 'tool-save-file', 'tool-read-file', 'tool-github-mcp'],
    assignedSpaces: ['space-engineering', 'space-launch'],
    computerEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'agent-aura',
    name: 'Aura',
    avatar: '👑',
    role: 'Executive Strategist',
    description: 'High-level coordinator. Synthesizes cross-space initiatives, prepares executive summaries, and orchestrates specialist task handoffs.',
    systemPrompt: 'You are Aura, an executive strategist and workflow coordinator. You break down ambitious goals into discrete agent tasks and review deliverables for quality.',
    status: 'idle',
    statusMessage: 'Coordinating team objectives',
    color: '#ec4899',
    allowedTools: ['tool-save-page', 'tool-web-search'],
    assignedSpaces: ['space-launch', 'space-research', 'space-engineering'],
    computerEnabled: true,
    createdAt: new Date().toISOString(),
  },
];

export const INITIAL_SPACES: Space[] = [
  {
    id: 'space-launch',
    name: 'Product & Launch Briefs',
    description: 'Central strategy hub for product specifications, launch materials, and roadmaps.',
    icon: '🚀',
    color: '#6366f1',
    assignedAgentIds: ['agent-scout', 'agent-quill', 'agent-aura'],
    createdAt: new Date().toISOString(),
    pages: [
      {
        id: 'page-nook-brief',
        spaceId: 'space-launch',
        title: 'Nook: Autonomous AI Coworker Operating System',
        icon: '🏠',
        authorAgentId: 'agent-quill',
        excerpt: 'Product blueprint and vision for persistent AI coworkers with persistent computers.',
        createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        version: 3,
        tags: ['strategy', 'v1.0', 'architecture'],
        content: `# Nook: The Autonomous AI Coworker OS

## 1. Executive Summary
**Nook** is an open-source, persistent agent environment where human teams and specialist AI agents collaborate effortlessly across documents, sandboxed computers, and real-time communication.

Unlike disposable chatbot threads that vanish after a session, **Nook Coworkers** maintain:
- **Persistent Memory & Personality**: Custom system instructions, dedicated roles, and tool authorization.
- **Dedicated Virtual Computers**: Independent browser session, sandbox terminal, and virtual file storage.
- **Living Spaces**: Collaborative document canvases with visual rich-text formatting and nested pages.
- **Human-in-the-Loop Safeguards**: Review-before-save approvals for high-stakes actions, file writes, and shell runs.

## 2. Core Architectural Pillars
\`\`\`text
+-----------------------------------------------------------+
|                        Nook Studio                        |
|   +-------------------+  +-----------------------------+  |
|   |   Spaces & Docs   |  |     Specialist Coworkers    |  |
|   |  - Visual Editor  |  |    (Scout, Quill, Cipher)   |  |
|   |  - Slash Commands |  |    - Persistent Context     |  |
|   |  - Review Cards   |  |    - Tool Access Matrix     |  |
|   +-------------------+  +-----------------------------+  |
|                 |                         |               |
|                 +------------+------------+               |
|                              |                            |
|             +---------------------------------+           |
|             |       Agent Computer Sandbox    |           |
|             |  - Headless Browser + Human PIP |           |
|             |  - Sandboxed Shell Execution    |           |
|             |  - Model Context Protocol (MCP) |           |
|             +---------------------------------+           |
+-----------------------------------------------------------+
\`\`\`

## 3. Specialist Role Breakdown
1. **Scout (Research & Web Intelligence)**: Dispatched to inspect technical repositories, competitors, and live URLs.
2. **Quill (Technical Writer)**: Curates raw findings into polished, publication-ready Spaces pages.
3. **Cipher (DevOps & Code Engineer)**: Runs shell verifications, spins up test containers, and checks API endpoints.
4. **Aura (Executive Strategist)**: Oversees milestone deliverables and coordinates multi-agent goals.

## 4. Immediate Roadmap (Milestone 1)
- [x] Initial Next.js 15 + Tailwind CSS workspace foundation
- [x] Persistent AI Coworkers management
- [x] Spaces document canvas with real-time markdown editor
- [x] Agent Computer preview with live browser and bash terminal
- [x] Interactive human-in-the-loop review cards for approved saves
- [ ] Phase 2: WebRTC Voice Calls with real-time audio visualizer`,
      },
      {
        id: 'page-design-tokens',
        spaceId: 'space-launch',
        title: 'Design System & Micro-Interactions',
        icon: '🎨',
        authorAgentId: 'agent-aura',
        excerpt: 'Color palettes, typography guidelines, and UX heuristics for the Nook interface.',
        createdAt: new Date(Date.now() - 3600000 * 8).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        version: 1,
        tags: ['design', 'ui-ux'],
        content: `# Nook Design Principles

### 1. Warm Sanctuary Aesthetic
Nook avoids sterile, cold gray interfaces. It pairs an ambient deep-space canvas (\`#0b0f17\`) with cozy, glowing jewel tones:
- **Indigo / Violet (\`#6366f1\`)**: Research & Discovery
- **Emerald (\`#10b981\`)**: Writing & Approved Documents
- **Amber (\`#f59e0b\`)**: Terminal Operations & Sandboxes
- **Rose (\`#ec4899\`)**: Executive Synthesis & Strategy

### 2. Radical Transparency
Every action taken by an agent is visible:
- When an agent is thinking, the reasoner steps appear as an unfolding accordion.
- When an agent opens a URL, the Computer panel mirrors the viewport.
- Before a page is modified or a command runs, a review card requests your sign-off.`,
      },
    ],
  },
  {
    id: 'space-research',
    name: 'Research & Knowledge Base',
    description: 'Synthesized intelligence, industry benchmarks, and technology evaluations.',
    icon: '🔬',
    color: '#10b981',
    assignedAgentIds: ['agent-scout', 'agent-quill'],
    createdAt: new Date().toISOString(),
    pages: [
      {
        id: 'page-agent-benchmarks',
        spaceId: 'space-research',
        title: 'OpenDots Architecture Comparative Study',
        icon: '📊',
        authorAgentId: 'agent-scout',
        excerpt: 'Technical breakdown of CopilotKit OpenDots, AG-UI protocol, and OpenBot sandbox.',
        createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
        version: 2,
        tags: ['research', 'benchmarks', 'opendots'],
        content: `# OpenDots Architecture Comparative Study

## Key Findings from GitHub Analysis
OpenDots by CopilotKit is built upon three foundational primitives:
1. **AG-UI Protocol**: A streaming UI-to-agent protocol standard that sends structured JSON events for tool cards, human-in-the-loop approvals, and progress updates.
2. **OpenBot Container Supervisor**: A Docker-based virtual computer assigned to each agent, providing isolated browser profiles and terminal execution.
3. **Spaces Document Layer**: Local SQLite/Postgres document store that connects threads to documents.

## Nook Enhancements
- **Multi-Provider Direct Engine**: Nook runs with Gemini, OpenAI, Claude, or local Ollama out of the box with zero complex external dependencies.
- **Interactive Human Takeover**: Users can click "Takeover" in the browser preview to type or scroll directly into the agent's web session.
- **Instant Client-Side Sandbox**: Built-in simulated computer environment for instant local evaluation without needing heavyweight Docker daemons.`,
      },
    ],
  },
  {
    id: 'space-engineering',
    name: 'Engineering & DevOps',
    description: 'Infrastructure notes, MCP connection configs, and terminal automation scripts.',
    icon: '⚡',
    color: '#f59e0b',
    assignedAgentIds: ['agent-cipher'],
    createdAt: new Date().toISOString(),
    pages: [
      {
        id: 'page-mcp-guide',
        spaceId: 'space-engineering',
        title: 'Model Context Protocol (MCP) Setup',
        icon: '🔌',
        authorAgentId: 'agent-cipher',
        excerpt: 'Standardizing agent tool integration via Anthropic Model Context Protocol servers.',
        createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
        version: 1,
        tags: ['mcp', 'tools', 'integrations'],
        content: `# Model Context Protocol (MCP) in Nook

Nook supports connecting arbitrary MCP servers:
- **Web Search MCP**: Real-time web crawling and synthesis.
- **Filesystem MCP**: Reading and writing project workspace directories.
- **GitHub MCP**: Creating pull requests, querying issues, and reading commit diffs.
- **Postgres / SQL MCP**: Safe read-only data queries with parameter validation.

### Permission Model
- **Read-Only Tools**: Can run autonomously (configurable per agent).
- **Mutating Tools**: Automatically pause and generate an **Approve & Run** review card in the chat stream.`,
      },
    ],
  },
];

export const INITIAL_MCP_TOOLS: MCPTool[] = [
  {
    id: 'tool-web-search',
    name: 'web_search',
    serverName: 'Nook Web Explorer',
    description: 'Searches the web for latest information, technical documentation, and news.',
    category: 'web',
    enabled: true,
    requiresApproval: false,
    parameters: [
      { name: 'query', type: 'string', required: true, description: 'The search query to look up' },
    ],
  },
  {
    id: 'tool-web-browse',
    name: 'browse_url',
    serverName: 'Nook Browser Sandbox',
    description: 'Navigates to a target URL, renders content in the agent computer, and extracts markdown.',
    category: 'web',
    enabled: true,
    requiresApproval: false,
    parameters: [
      { name: 'url', type: 'string', required: true, description: 'The URL to navigate to' },
    ],
  },
  {
    id: 'tool-terminal-exec',
    name: 'execute_command',
    serverName: 'Nook Bash Runtime',
    description: 'Executes a command inside the agent isolated container environment.',
    category: 'system',
    enabled: true,
    requiresApproval: true,
    parameters: [
      { name: 'command', type: 'string', required: true, description: 'The shell command line to run' },
    ],
  },
  {
    id: 'tool-save-page',
    name: 'save_to_space',
    serverName: 'Nook Spaces Store',
    description: 'Creates or updates a living document in an authorized Space.',
    category: 'data',
    enabled: true,
    requiresApproval: true,
    parameters: [
      { name: 'spaceId', type: 'string', required: true, description: 'Target Space ID' },
      { name: 'title', type: 'string', required: true, description: 'Document Title' },
      { name: 'content', type: 'string', required: true, description: 'Markdown Content' },
    ],
  },
  {
    id: 'tool-save-file',
    name: 'write_file',
    serverName: 'Nook Virtual Filesystem',
    description: 'Writes data to a virtual file on the agent computer storage.',
    category: 'code',
    enabled: true,
    requiresApproval: false,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path relative to /workspace' },
      { name: 'content', type: 'string', required: true, description: 'File contents' },
    ],
  },
  {
    id: 'tool-github-mcp',
    name: 'github_inspector',
    serverName: 'GitHub MCP Connector',
    description: 'Inspects repositories, issues, and commit logs on GitHub.',
    category: 'code',
    enabled: true,
    requiresApproval: false,
    parameters: [
      { name: 'repo', type: 'string', required: true, description: 'Repository name e.g. CopilotKit/OpenDots' },
      { name: 'action', type: 'string', required: true, description: 'Action to perform: get_readme | list_issues' },
    ],
  },
];

export const INITIAL_COMPUTER_STATES: Record<string, ComputerState> = {
  'agent-scout': {
    agentId: 'agent-scout',
    url: 'https://github.com/CopilotKit/OpenDots',
    pageTitle: 'GitHub - CopilotKit/OpenDots: Always-on AI coworkers',
    isLoading: false,
    takeoverMode: false,
    history: ['https://github.com/CopilotKit/OpenDots', 'https://docs.copilotkit.ai'],
    historyIndex: 0,
    terminalLogs: [
      { id: '1', type: 'system', text: 'Initializing Scout Virtual Container (Ubuntu 24.04 LTS)...', timestamp: '10:00:01' },
      { id: '2', type: 'input', text: 'curl -s https://api.github.com/repos/CopilotKit/OpenDots | jq .stargazers_count', timestamp: '10:00:05' },
      { id: '3', type: 'output', text: '2450', timestamp: '10:00:06' },
      { id: '4', type: 'system', text: 'Browser profile initialized with persistent cookies.', timestamp: '10:00:08' },
    ],
    files: [
      { path: '/workspace/scout_findings.md', name: 'scout_findings.md', size: '2.4 KB', type: 'file', updatedAt: 'Just now', content: '# Scout Research Findings\n- OpenDots uses CopilotKit Channels\n- AG-UI protocol handles stream events\n- OpenBot provides sandbox supervisor' },
      { path: '/workspace/bookmarks.json', name: 'bookmarks.json', size: '380 B', type: 'file', updatedAt: '10 mins ago', content: '[\n  "https://github.com/CopilotKit/OpenDots",\n  "https://docs.ag-ui.com"\n]' },
    ],
    activityLogs: [
      { id: 'act-1', timestamp: '10:02:15', action: 'Navigate', details: 'Navigated to https://github.com/CopilotKit/OpenDots' },
      { id: 'act-2', timestamp: '10:02:40', action: 'Extract', details: 'Extracted README.md content and architecture diagram' },
      { id: 'act-3', timestamp: '10:03:10', action: 'File Write', details: 'Saved notes to /workspace/scout_findings.md' },
    ],
  },
  'agent-cipher': {
    agentId: 'agent-cipher',
    url: 'http://localhost:3000/api/health',
    pageTitle: 'Nook Health Check Dashboard',
    isLoading: false,
    takeoverMode: false,
    history: ['http://localhost:3000/api/health'],
    historyIndex: 0,
    terminalLogs: [
      { id: '1', type: 'system', text: 'Cipher Engineering Shell ready. Docker socket mapped.', timestamp: '09:45:00' },
      { id: '2', type: 'input', text: 'docker ps --format "{{.Names}}: {{.Status}}"', timestamp: '09:45:12' },
      { id: '3', type: 'output', text: 'nook-sandbox-scout: Up 42 minutes\nnook-sandbox-quill: Up 42 minutes\nnook-sandbox-cipher: Up 42 minutes', timestamp: '09:45:13' },
      { id: '4', type: 'input', text: 'npm test', timestamp: '09:50:02' },
      { id: '5', type: 'output', text: 'PASS src/__tests__/review-card.test.ts\nPASS src/__tests__/mcp-connector.test.ts\nTest Suites: 2 passed, 2 total', timestamp: '09:50:06' },
    ],
    files: [
      { path: '/workspace/deploy.sh', name: 'deploy.sh', size: '1.1 KB', type: 'file', updatedAt: '1 hour ago', content: '#!/usr/bin/env bash\necho "Building Nook production bundle..."\nnode ./node_modules/next/dist/bin/next build' },
      { path: '/workspace/metrics.log', name: 'metrics.log', size: '4.2 KB', type: 'file', updatedAt: '5 mins ago', content: '2026-10-26T10:00:00Z CPU=1.2% MEM=312MB\n2026-10-26T10:05:00Z CPU=0.9% MEM=315MB' },
    ],
    activityLogs: [
      { id: 'c-1', timestamp: '09:45:12', action: 'Bash Run', details: 'Checked Docker container supervisors' },
      { id: 'c-2', timestamp: '09:50:02', action: 'Test Suite', details: 'Ran automated sandbox test suites (All Passed)' },
    ],
  },
  'agent-quill': {
    agentId: 'agent-quill',
    url: 'https://docs.ag-ui.com',
    pageTitle: 'AG-UI Protocol Specification',
    isLoading: false,
    takeoverMode: false,
    history: ['https://docs.ag-ui.com'],
    historyIndex: 0,
    terminalLogs: [
      { id: '1', type: 'system', text: 'Quill Document Engine mounted.', timestamp: '10:10:00' },
      { id: '2', type: 'input', text: 'markdown-lint /workspace/drafts/*.md', timestamp: '10:12:15' },
      { id: '3', type: 'output', text: 'All 4 document drafts comply with style guide.', timestamp: '10:12:16' },
    ],
    files: [
      { path: '/workspace/launch_draft.md', name: 'launch_draft.md', size: '3.8 KB', type: 'file', updatedAt: '2 mins ago', content: '# Nook Launch Announcement Draft\nPersistent AI coworkers for the autonomous era.' },
    ],
    activityLogs: [
      { id: 'q-1', timestamp: '10:12:15', action: 'Doc Lint', details: 'Validated Markdown syntax and headers' },
    ],
  },
  'agent-aura': {
    agentId: 'agent-aura',
    url: 'https://news.ycombinator.com',
    pageTitle: 'Hacker News - Technology & AI',
    isLoading: false,
    takeoverMode: false,
    history: ['https://news.ycombinator.com'],
    historyIndex: 0,
    terminalLogs: [
      { id: '1', type: 'system', text: 'Aura Executive Shell active.', timestamp: '09:30:00' },
    ],
    files: [
      { path: '/workspace/okrs_2026.md', name: 'okrs_2026.md', size: '1.5 KB', type: 'file', updatedAt: 'Today', content: '# Nook Q4 OKRs\n1. Deliver autonomous AI coworker workspace\n2. Maintain 100% human-in-the-loop review safety' },
    ],
    activityLogs: [
      { id: 'a-1', timestamp: '09:32:00', action: 'Strategy Review', details: 'Reviewed quarterly milestones' },
    ],
  },
};

export const INITIAL_MESSAGES: Record<string, Message[]> = {
  'agent-scout': [
    {
      id: 'msg-s1',
      sender: 'agent',
      agentId: 'agent-scout',
      content: 'Hey there! I am **Scout**, your research coworker. I have access to a dedicated browser computer and web tools.\n\nI just crawled through the `CopilotKit/OpenDots` architecture to see how it operates. Would you like me to compile a comprehensive Launch Brief and draft it directly into your **Product & Launch Briefs** Space?',
      timestamp: '10:00 AM',
    },
    {
      id: 'msg-s2',
      sender: 'user',
      content: 'Yes Scout! Browse the repo, examine its key components, and prepare a draft page for our Space.',
      timestamp: '10:01 AM',
    },
    {
      id: 'msg-s3',
      sender: 'agent',
      agentId: 'agent-scout',
      content: 'I have finished analyzing the repo structure, Docker computer supervisor, and the human-in-the-loop approvals. Here is the draft document I prepared for your review before saving to the Space.',
      timestamp: '10:03 AM',
      thoughtProcess: [
        'Opened https://github.com/CopilotKit/OpenDots in agent computer browser',
        'Extracted README.md, package.json dependencies, and computer supervisor docs',
        'Compared features: Specialist Dots, Sandboxed Computers, Review-before-save, Spaces',
        'Drafted high-impact launch brief with markdown formatting and architectural diagrams',
      ],
      toolCall: {
        toolName: 'browse_url',
        status: 'completed',
        input: { url: 'https://github.com/CopilotKit/OpenDots' },
        output: 'Successfully extracted 119 lines of README content and repository structure.',
      },
      reviewRequest: {
        id: 'rev-scout-01',
        agentId: 'agent-scout',
        agentName: 'Scout',
        type: 'save_page',
        title: 'New Page: OpenDots Architecture & Nook Roadmap',
        description: 'Scout wants to save a synthesized research report directly into the "Product & Launch Briefs" Space.',
        targetSpaceId: 'space-launch',
        payload: {
          pageTitle: 'OpenDots Architecture & Nook Roadmap',
          pageContent: `# OpenDots Architecture & Nook Roadmap

### Overview
OpenDots provides an open-source template for persistent AI agents, each with its own computer. In Nook, we take this vision and streamline it into an autonomous coworker sanctuary:

### Key Differences & Upgrades
| Feature | OpenDots | Nook |
| :--- | :--- | :--- |
| **LLM Provider** | Hosted CopilotKit Cloud / Docker | Multi-Provider (Gemini, OpenAI, Claude, Local Ollama) |
| **Agent Computer** | Docker container requirement | Instant Interactive Sandbox + Live Web & Shell |
| **Human Takeover** | Viewport stream | Instant one-click interactive browser takeover |
| **Document Editor**| Markdown source / basic | Rich visual canvas with slash commands & autosave |

### Recommendations
1. Deploy persistent coworkers with explicit tool boundaries.
2. Ensure every critical action triggers an interactive **Review Card** for human sign-off.
3. Organize all project knowledge into modular **Spaces**.`,
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    },
  ],
  'agent-quill': [
    {
      id: 'msg-q1',
      sender: 'agent',
      agentId: 'agent-quill',
      content: 'Hello! I am **Quill**, your lead technical writer. I am ready to review your draft pages, add technical specifications, or produce customer-facing release notes. Which Space are we writing for today?',
      timestamp: '10:15 AM',
    },
  ],
  'agent-cipher': [
    {
      id: 'msg-c1',
      sender: 'agent',
      agentId: 'agent-cipher',
      content: 'Hey! **Cipher** online. My isolated bash terminal is ready. I can run shell commands, inspect repo files, execute test suites, or test API webhooks.\n\nType a command or tell me what you need built!',
      timestamp: '09:50 AM',
    },
  ],
  'agent-aura': [
    {
      id: 'msg-a1',
      sender: 'agent',
      agentId: 'agent-aura',
      content: 'Good day! I am **Aura**, your executive strategist. I can help coordinate the squad, set quarterly milestones, and review drafts across all Spaces.',
      timestamp: '09:30 AM',
    },
  ],
};

export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  provider: 'simulation',
  geminiApiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  ollamaEndpoint: 'http://localhost:11434',
  model: 'gemini-1.5-flash',
  temperature: 0.7,
};
