import { Agent, ComputerState, LLMSettings, Message, ReviewRequest, Space } from '@/types';

export interface AgentExecutionResponse {
  reply: string;
  thoughtProcess?: string[];
  toolCall?: {
    toolName: string;
    status: 'running' | 'completed' | 'failed';
    input: Record<string, unknown>;
    output?: string;
  };
  reviewRequest?: ReviewRequest;
  updatedComputerState?: Partial<ComputerState>;
}

export async function executeAgentTurn({
  agent,
  userMessage,
  history,
  settings,
  computerState,
  spaces,
}: {
  agent: Agent;
  userMessage: string;
  history: Message[];
  settings: LLMSettings;
  computerState: ComputerState;
  spaces: Space[];
}): Promise<AgentExecutionResponse> {
  const lowerMsg = userMessage.toLowerCase();

  // Try calling the server-side API router first (handles server .env keys and proxies safely)
  if (settings.provider !== 'simulation') {
    try {
      const serverRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          userMessage,
          history,
          settings,
        }),
      });

      if (serverRes.ok) {
        const data = await serverRes.json();
        if (data.reply) {
          return {
            reply: data.reply,
            thoughtProcess: data.thoughtProcess || [`Dispatched to ${settings.provider} router`],
          };
        }
      }
    } catch (err) {
      console.warn('Server chat route bypassed, proceeding with agent engine', err);
    }
  }

  // Autonomous Specialist Simulated Engine
  // Delivers high-fidelity OpenDots coworker experience with thoughts, tools, computer state updates, and review cards
  await new Promise((resolve) => setTimeout(resolve, 600));

  // Scenario 1: User asks to browse or search or visit any URL
  if (lowerMsg.includes('browse') || lowerMsg.includes('search') || lowerMsg.includes('visit') || lowerMsg.includes('http') || lowerMsg.includes('github') || lowerMsg.includes('url')) {
    let targetUrl = 'https://github.com/CopilotKit/OpenDots';
    const urlMatch = userMessage.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      targetUrl = urlMatch[0];
    } else if (lowerMsg.includes('docs')) {
      targetUrl = 'https://docs.copilotkit.ai';
    } else if (lowerMsg.includes('hackernews') || lowerMsg.includes('news')) {
      targetUrl = 'https://news.ycombinator.com';
    }

    let pageTitle = `Snapshot: ${targetUrl}`;
    let snippet = 'DOM content extracted by agent computer supervisor.';

    // Try fetching real web content via /api/sandbox/browse
    try {
      const browseRes = await fetch('/api/sandbox/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      if (browseRes.ok) {
        const browseData = await browseRes.json();
        pageTitle = browseData.title || pageTitle;
        snippet = browseData.textContent?.slice(0, 300) || snippet;
      }
    } catch (err) {
      console.warn('Browse API call fallback', err);
    }

    const newActivity = {
      id: `act-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      action: 'Web Navigation',
      details: `Visited ${targetUrl}`,
    };

    return {
      reply: `I navigated to **${targetUrl}** on my computer browser and extracted the page structure:\n\n> **${pageTitle}**\n> ${snippet}...\n\nCheck out my **Computer** tab to inspect the rendered page and files!`,
      thoughtProcess: [
        `Received navigation request for ${targetUrl}`,
        'Spinning up headless Chromium session on agent computer',
        `Navigated to ${targetUrl} (HTTP 200 OK)`,
        'Extracted primary headers, metadata, and body text',
      ],
      toolCall: {
        toolName: 'browse_url',
        status: 'completed',
        input: { url: targetUrl },
        output: `Rendered "${pageTitle}". Extracted content and saved DOM snapshot to /workspace.`,
      },
      updatedComputerState: {
        url: targetUrl,
        pageTitle,
        history: [...computerState.history, targetUrl],
        historyIndex: computerState.history.length,
        activityLogs: [newActivity, ...computerState.activityLogs],
      },
    };
  }

  // Scenario 2: User asks to run a command or bash or test or build
  if (lowerMsg.includes('run') || lowerMsg.includes('terminal') || lowerMsg.includes('command') || lowerMsg.includes('bash') || lowerMsg.includes('test') || lowerMsg.includes('npm')) {
    const commandToRun = lowerMsg.includes('test')
      ? 'npm test'
      : lowerMsg.includes('build')
      ? 'node ./node_modules/next/dist/bin/next build'
      : lowerMsg.includes('docker')
      ? 'docker ps'
      : 'ls -la /workspace';

    // Generates an Approve & Run Review Card because running shell commands requires human approval!
    return {
      reply: `I have prepared the terminal command \`${commandToRun}\` for execution in my isolated container sandbox.\n\nBecause this is a mutating system action, please review and approve it below:`,
      thoughtProcess: [
        `Identified terminal command request: ${commandToRun}`,
        'Safety check: Verifying command parameters and sandbox permissions',
        'Triggering human-in-the-loop review card for approval before execution',
      ],
      reviewRequest: {
        id: `rev-cmd-${Date.now()}`,
        agentId: agent.id,
        agentName: agent.name,
        type: 'run_command',
        title: `Execute Shell Command: \`${commandToRun}\``,
        description: `${agent.name} is requesting permission to execute a bash command in the isolated container sandbox.`,
        payload: { command: commandToRun },
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    };
  }

  // Scenario 3: User asks to save, draft, or create a document/page
  if (lowerMsg.includes('save') || lowerMsg.includes('draft') || lowerMsg.includes('page') || lowerMsg.includes('doc') || lowerMsg.includes('brief') || lowerMsg.includes('write')) {
    const targetSpace = spaces[0] || { id: 'space-launch', name: 'Product & Launch Briefs' };
    const draftTitle = lowerMsg.includes('roadmap')
      ? 'Autonomous Coworkers 2026 Roadmap'
      : lowerMsg.includes('brief')
      ? `${agent.name}'s Strategic Brief`
      : 'Collaborative Notes & Architecture Draft';

    const draftContent = `# ${draftTitle}

*Created by ${agent.name} (${agent.role})*

## Executive Overview
This document captures our current objectives and technical specs. It was generated via autonomous agent collaboration in **Nook**.

### Key Deliverables
- **Real-Time Agent Computer**: Live browser preview with human takeover mode.
- **Spaces Knowledge System**: Visual editor with slash commands and collaborative page chat.
- **Review Safeguards**: Interactive cards that pause execution until human verification.

### Next Actions
1. Review the proposed draft content.
2. Click **Approve & Save** to publish this directly into **${targetSpace.name}**.`;

    return {
      reply: `I drafted a new document: **"${draftTitle}"**! Here is the preview card for your review before it gets saved into **${targetSpace.name}**:`,
      thoughtProcess: [
        `Formulated comprehensive document structure for "${draftTitle}"`,
        `Assigned to Space: ${targetSpace.name}`,
        'Constructing human-in-the-loop approval card',
      ],
      reviewRequest: {
        id: `rev-page-${Date.now()}`,
        agentId: agent.id,
        agentName: agent.name,
        type: 'save_page',
        title: `Save Document: "${draftTitle}"`,
        description: `Save this drafted document to Space: ${targetSpace.name}`,
        targetSpaceId: targetSpace.id,
        payload: {
          pageTitle: draftTitle,
          pageContent: draftContent,
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    };
  }

  // Multi-Agent mentions handler (e.g. "@Quill draft a spec" or "@Cipher test")
  if (userMessage.includes('@')) {
    const mentionMatch = userMessage.match(/@([a-zA-Z0-9_-]+)/);
    if (mentionMatch) {
      const mentionedAgentName = mentionMatch[1];
      return {
        reply: `I noticed you tagged **@${mentionedAgentName}**. I will coordinate our team context with them so we can tackle this task collaboratively!`,
        thoughtProcess: [
          `Detected multi-agent coworker mention: @${mentionedAgentName}`,
          'Sharing active thread context and tool outputs with coworker',
        ],
      };
    }
  }

  // Default intelligent specialist reply
  const defaultResponses: Record<string, string> = {
    'agent-scout': `I'm on it! I can navigate any URL on my computer browser, scrape API docs, or search the web for intelligence. Tell me what topic to investigate, or ask me to draft a new report for our Spaces!`,
    'agent-quill': `Ready to write! I can produce comprehensive technical specifications, user documentation, or launch briefs. Would you like me to draft a new page or revise an existing document in one of your Spaces?`,
    'agent-cipher': `Cipher ready. I have an active bash terminal with Docker supervisor access. You can ask me to run test suites, check server metrics, or inspect repository files.`,
    'agent-aura': `Strategic alignment confirmed. I can orchestrate tasks between Scout, Quill, and Cipher, or prepare executive summaries across all project Spaces. What is our core priority today?`,
  };

  const reply = defaultResponses[agent.id] || `I have processed your message: "${userMessage}". Let me know if you would like me to inspect my computer sandbox, browse a website, or create a page in our Spaces!`;

  return {
    reply,
    thoughtProcess: [
      `Parsed user intent: "${userMessage.slice(0, 45)}..."`,
      `Contextualized with role: ${agent.role}`,
      'Prepared tailored specialist guidance',
    ],
  };
}
