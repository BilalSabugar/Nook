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

  // If user configured real Gemini API Key
  if (settings.provider === 'gemini' && settings.geminiApiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${settings.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: `${agent.systemPrompt}\nYou have access to an agent computer (browser, bash terminal, files). When proposing to create a page or run a dangerous command, request review.` }]
            },
            contents: [
              ...history.slice(-6).map((m) => ({
                role: m.sender === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }],
              })),
              { role: 'user', parts: [{ text: userMessage }] }
            ],
          }),
        }
      );
      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
        return {
          reply: text,
          thoughtProcess: ['Invoked Gemini 1.5 Flash with agent context', 'Evaluated instructions and generated response'],
        };
      }
    } catch (e) {
      console.error('Gemini API call failed, falling back to agent engine', e);
    }
  }

  // If user configured OpenAI API Key
  if (settings.provider === 'openai' && settings.openaiApiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: settings.model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: agent.systemPrompt },
            ...history.slice(-6).map((m) => ({
              role: m.sender === 'user' ? 'user' : 'assistant',
              content: m.content,
            })),
            { role: 'user', content: userMessage },
          ],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || 'No response generated.';
        return {
          reply: text,
          thoughtProcess: ['Invoked OpenAI model', 'Processed context and returned output'],
        };
      }
    } catch (e) {
      console.error('OpenAI call failed, falling back to agent engine', e);
    }
  }

  // Autonomous Specialist Simulated Engine
  // Delivers high-fidelity OpenDots coworker experience with thoughts, tools, computer state updates, and review cards
  await new Promise((resolve) => setTimeout(resolve, 800));

  // Scenario 1: User asks to browse or search
  if (lowerMsg.includes('browse') || lowerMsg.includes('search') || lowerMsg.includes('visit') || lowerMsg.includes('http') || lowerMsg.includes('github')) {
    const targetUrl = lowerMsg.includes('github')
      ? 'https://github.com/CopilotKit/OpenDots'
      : lowerMsg.includes('docs')
      ? 'https://docs.copilotkit.ai'
      : 'https://news.ycombinator.com';

    const pageTitle = lowerMsg.includes('github')
      ? 'GitHub - CopilotKit/OpenDots: Always-on AI coworkers'
      : 'Documentation & Architecture Overview';

    const newActivity = {
      id: `act-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      action: 'Web Navigation',
      details: `Visited ${targetUrl}`,
    };

    return {
      reply: `I navigated to **${targetUrl}** on my computer browser and extracted the page contents.\n\nThe service is active and I have synchronized the DOM snapshot to my workspace files. Check out my **Computer** tab to see the live view!`,
      thoughtProcess: [
        `Received navigation request for ${targetUrl}`,
        'Spinning up headless Chromium session on agent computer',
        `Navigated to ${targetUrl}`,
        'Extracted primary headers, documentation, and metadata',
      ],
      toolCall: {
        toolName: 'browse_url',
        status: 'completed',
        input: { url: targetUrl },
        output: `Rendered ${pageTitle} (HTTP 200 OK). Parsed 4,200 bytes.`,
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
      ? 'docker status'
      : 'ls -la /workspace';

    // Generates an Approve & Run Review Card because running shell commands requires human approval!
    return {
      reply: `I have prepared the terminal command \`${commandToRun}\` for execution in my isolated sandbox.\n\nBecause this is a mutating system action, please review and approve it below:`,
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
        description: `${agent.name} is requesting permission to execute a bash command in the isolated container.`,
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
