'use client';

import React, { useState, useEffect } from 'react';
import { 
  Agent, 
  Space, 
  ComputerState, 
  MCPTool, 
  LLMSettings, 
  Message, 
  DocumentPage,
  ReviewRequest 
} from '@/types';
import { 
  INITIAL_AGENTS, 
  INITIAL_SPACES, 
  INITIAL_COMPUTER_STATES, 
  INITIAL_MCP_TOOLS, 
  INITIAL_MESSAGES, 
  DEFAULT_LLM_SETTINGS 
} from '@/lib/store';
import { executeAgentTurn } from '@/lib/llm-service';

// Components
import { Sidebar } from '@/components/navigation/Sidebar';
import { AgentChat } from '@/components/chat/AgentChat';
import { SpaceWorkspace } from '@/components/spaces/SpaceWorkspace';
import { NookComputer } from '@/components/computer/NookComputer';
import { McpManager } from '@/components/tools/McpManager';

// Modals
import { AgentModal } from '@/components/modals/AgentModal';
import { SpaceModal } from '@/components/modals/SpaceModal';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { CommandPalette } from '@/components/navigation/CommandPalette';

export default function NookApp() {
  // Primary State
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [spaces, setSpaces] = useState<Space[]>(INITIAL_SPACES);
  const [computerStates, setComputerStates] = useState<Record<string, ComputerState>>(INITIAL_COMPUTER_STATES);
  const [messages, setMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>(INITIAL_MCP_TOOLS);
  const [llmSettings, setLlmSettings] = useState<LLMSettings>(DEFAULT_LLM_SETTINGS);

  // Navigation State
  const [activeView, setActiveView] = useState<'space' | 'agent' | 'computer' | 'tools'>('agent');
  const [activeAgentId, setActiveAgentId] = useState<string>('agent-scout');
  const [activeSpaceId, setActiveSpaceId] = useState<string>('space-launch');
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // Chat Loading State
  const [isAgentResponding, setIsAgentResponding] = useState(false);

  // Modals
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [isSpaceModalOpen, setIsSpaceModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Global ⌘K / Ctrl+K keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load from LocalStorage if available with automatic legacy emoji migration
  useEffect(() => {
    try {
      const storedSettings = localStorage.getItem('nook_settings');
      if (storedSettings) setLlmSettings(JSON.parse(storedSettings));

      const storedAgents = localStorage.getItem('nook_agents');
      if (storedAgents) {
        const parsed: Agent[] = JSON.parse(storedAgents);
        const migrated = parsed.map((a) => {
          let av = a.avatar;
          if (av === '🧭' || a.id === 'agent-scout') av = 'compass';
          else if (av === '✍️' || a.id === 'agent-quill') av = 'pen-tool';
          else if (av === '⚡' || a.id === 'agent-cipher') av = 'cpu';
          else if (av === '👑' || a.id === 'agent-aura') av = 'sparkles';
          return { ...a, avatar: av };
        });
        setAgents(migrated);
      }

      const storedSpaces = localStorage.getItem('nook_spaces');
      if (storedSpaces) {
        const parsed: Space[] = JSON.parse(storedSpaces);
        const migrated = parsed.map((s) => {
          let ic = s.icon;
          if (ic === '🚀' || s.id === 'space-launch') ic = 'layers';
          else if (ic === '🔬' || s.id === 'space-research') ic = 'search';
          else if (ic === '⚡' || s.id === 'space-engineering') ic = 'cpu';
          const pages = (s.pages || []).map((p) => {
            let pIc = p.icon;
            if (pIc === '🏠') pIc = 'file-text';
            else if (pIc === '🎨') pIc = 'palette';
            else if (pIc === '📊') pIc = 'bar-chart';
            else if (pIc === '🔌') pIc = 'plug';
            return { ...p, icon: pIc };
          });
          return { ...s, icon: ic, pages };
        });
        setSpaces(migrated);
      }
    } catch (e) {
      console.warn('LocalStorage retrieval bypassed', e);
    }
  }, []);

  // Save to LocalStorage helpers
  const persistAgents = (updated: Agent[]) => {
    setAgents(updated);
    try {
      localStorage.setItem('nook_agents', JSON.stringify(updated));
    } catch {}
  };

  const persistSpaces = (updated: Space[]) => {
    setSpaces(updated);
    try {
      localStorage.setItem('nook_spaces', JSON.stringify(updated));
    } catch {}
  };

  const persistSettings = (updated: LLMSettings) => {
    setLlmSettings(updated);
    try {
      localStorage.setItem('nook_settings', JSON.stringify(updated));
    } catch {}
  };

  // Switch to Space
  const handleSelectSpace = (spaceId: string) => {
    setActiveSpaceId(spaceId);
    setActivePageId(null);
    setActiveView('space');
  };

  // Switch to Agent
  const handleSelectAgent = (agentId: string) => {
    setActiveAgentId(agentId);
    setActiveView('agent');
  };

  // Send Message to Agent
  const handleSendMessage = async (text: string) => {
    const currentAgent = agents.find((a) => a.id === activeAgentId);
    if (!currentAgent) return;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const currentAgentMessages = messages[activeAgentId] || [];
    const updatedMessages = [...currentAgentMessages, userMsg];
    setMessages((prev) => ({ ...prev, [activeAgentId]: updatedMessages }));

    // Set Agent to 'thinking'
    setAgents((prev) =>
      prev.map((a) =>
        a.id === activeAgentId
          ? { ...a, status: 'thinking', statusMessage: 'Reasoning and coordinating tools...' }
          : a
      )
    );
    setIsAgentResponding(true);

    try {
      const currentComputer = computerStates[activeAgentId] || {
        agentId: activeAgentId,
        url: 'https://github.com/CopilotKit/OpenDots',
        pageTitle: 'OpenDots',
        isLoading: false,
        takeoverMode: false,
        history: ['https://github.com/CopilotKit/OpenDots'],
        historyIndex: 0,
        terminalLogs: [],
        files: [],
        activityLogs: [],
      };

      const result = await executeAgentTurn({
        agent: currentAgent,
        userMessage: text,
        history: updatedMessages,
        settings: llmSettings,
        computerState: currentComputer,
        spaces,
      });

      // Update Computer State if agent browsed or executed
      if (result.updatedComputerState) {
        setComputerStates((prev) => ({
          ...prev,
          [activeAgentId]: {
            ...currentComputer,
            ...result.updatedComputerState,
          },
        }));
      }

      // Agent Reply Message
      const agentMsg: Message = {
        id: `msg-agent-${Date.now()}`,
        sender: 'agent',
        agentId: activeAgentId,
        content: result.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        thoughtProcess: result.thoughtProcess,
        toolCall: result.toolCall,
        reviewRequest: result.reviewRequest,
      };

      setMessages((prev) => ({
        ...prev,
        [activeAgentId]: [...(prev[activeAgentId] || []), agentMsg],
      }));
    } catch (err) {
      console.error('Agent turn failed', err);
    } finally {
      setIsAgentResponding(false);
      setAgents((prev) =>
        prev.map((a) =>
          a.id === activeAgentId
            ? { ...a, status: 'idle', statusMessage: 'Ready for collaboration' }
            : a
        )
      );
    }
  };

  // Handle Review Approvals (Human-in-the-Loop)
  const handleApproveReview = (reviewId: string) => {
    // 1. Locate the review in the messages
    const currentAgentMsgs = messages[activeAgentId] || [];
    let targetReview: ReviewRequest | undefined;

    const updatedMsgs = currentAgentMsgs.map((m) => {
      if (m.reviewRequest && m.reviewRequest.id === reviewId) {
        targetReview = m.reviewRequest;
        return {
          ...m,
          reviewRequest: { ...m.reviewRequest, status: 'approved' as const },
        };
      }
      return m;
    });

    setMessages((prev) => ({ ...prev, [activeAgentId]: updatedMsgs }));

    if (!targetReview) return;

    // 2. Perform the approved action
    if (targetReview.type === 'save_page' && targetReview.targetSpaceId && targetReview.payload.pageTitle) {
      const targetSpace = spaces.find((s) => s.id === targetReview?.targetSpaceId) || spaces[0];
      const newPage: DocumentPage = {
        id: `page-${Date.now()}`,
        spaceId: targetSpace.id,
        title: targetReview.payload.pageTitle,
        content: targetReview.payload.pageContent || '',
        excerpt: targetReview.payload.pageContent
          ?.replace(/#+/g, '')
          .replace(/[*_`~[\]]/g, '')
          .replace(/\|.*?\|/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120),
        icon: 'file-text',
        authorAgentId: targetReview.agentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        tags: ['approved', targetReview.agentName.toLowerCase()],
      };

      const updatedSpaces = spaces.map((s) =>
        s.id === targetSpace.id ? { ...s, pages: [newPage, ...s.pages] } : s
      );

      persistSpaces(updatedSpaces);

      // Save createdPageId on the review request in messages
      const finalApprovedMsgs = updatedMsgs.map((m) => {
        if (m.reviewRequest && m.reviewRequest.id === reviewId) {
          return {
            ...m,
            reviewRequest: {
              ...m.reviewRequest,
              status: 'approved' as const,
              createdPageId: newPage.id,
            },
          };
        }
        return m;
      });

      // Feedback message in chat
      const followUpMsg: Message = {
        id: `msg-follow-${Date.now()}`,
        sender: 'system',
        content: `Document **"${newPage.title}"** was approved and created in **${targetSpace.name}**!`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => ({
        ...prev,
        [activeAgentId]: [...finalApprovedMsgs, followUpMsg],
      }));
    } else if (targetReview.type === 'run_command' && targetReview.payload.command) {
      // Execute command in Computer Sandbox
      handleExecuteTerminalCommand(targetReview.agentId, targetReview.payload.command);
    }
  };

  // Handle Review Declines
  const handleDeclineReview = (reviewId: string, feedback?: string) => {
    const currentAgentMsgs = messages[activeAgentId] || [];
    const updatedMsgs = currentAgentMsgs.map((m) => {
      if (m.reviewRequest && m.reviewRequest.id === reviewId) {
        return {
          ...m,
          reviewRequest: {
            ...m.reviewRequest,
            status: 'declined' as const,
            feedback,
          },
        };
      }
      return m;
    });

    setMessages((prev) => ({ ...prev, [activeAgentId]: updatedMsgs }));

    // Send notification to agent with the decline feedback
    const declineMsg: Message = {
      id: `msg-dec-${Date.now()}`,
      sender: 'user',
      content: feedback 
        ? `I have declined this draft with feedback: "${feedback}". Please revise.` 
        : `I declined this action. Let's try another approach.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => ({
      ...prev,
      [activeAgentId]: [...(prev[activeAgentId] || []), declineMsg],
    }));
  };

  // Execute Command in Computer Sandbox
  const handleExecuteTerminalCommand = async (agentId: string, command: string) => {
    const currentComp = computerStates[agentId] || INITIAL_COMPUTER_STATES[agentId];
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Append input command immediately to terminal
    const inputEntry = { id: `term-${Date.now()}-in`, type: 'input' as const, text: command, timestamp };
    setComputerStates((prev) => {
      const prevComp = prev[agentId] || currentComp;
      return {
        ...prev,
        [agentId]: {
          ...prevComp,
          terminalLogs: [...prevComp.terminalLogs, inputEntry],
        },
      };
    });

    try {
      const res = await fetch('/api/sandbox/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, agentId }),
      });
      const data = await res.json();
      const outputText = data.output || (data.error ? `Error: ${data.error}` : `Command executed. Exit code: ${data.exitCode ?? 0}`);
      const isError = res.status !== 200 || data.exitCode !== 0;

      const outputEntry = {
        id: `term-${Date.now()}-out`,
        type: (isError ? 'error' : 'output') as 'error' | 'output',
        text: outputText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };

      const newActivity = {
        id: `act-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        action: 'Shell Execution',
        details: `$ ${command} (exit: ${data.exitCode ?? (isError ? 1 : 0)})`,
      };

      setComputerStates((prev) => {
        const prevComp = prev[agentId] || currentComp;
        return {
          ...prev,
          [agentId]: {
            ...prevComp,
            terminalLogs: [...prevComp.terminalLogs, outputEntry],
            activityLogs: [newActivity, ...prevComp.activityLogs],
          },
        };
      });
    } catch {
      // Offline fallback
      let fallbackOutput = `Executed "${command}". Exit code: 0`;
      if (command.includes('ls')) {
        fallbackOutput = currentComp.files.map((f) => `-rw-r--r-- 1 nook nook ${f.size} ${f.name}`).join('\n');
      }
      const outputEntry = {
        id: `term-${Date.now()}-out`,
        type: 'output' as const,
        text: fallbackOutput,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };
      setComputerStates((prev) => {
        const prevComp = prev[agentId] || currentComp;
        return {
          ...prev,
          [agentId]: {
            ...prevComp,
            terminalLogs: [...prevComp.terminalLogs, outputEntry],
          },
        };
      });
    }
  };

  // Update Computer State
  const handleUpdateComputerState = (agentId: string, updates: Partial<ComputerState>) => {
    setComputerStates((prev) => ({
      ...prev,
      [agentId]: {
        ...(prev[agentId] || INITIAL_COMPUTER_STATES[agentId]),
        ...updates,
      },
    }));
  };

  // Space Page Handlers
  const handleCreatePage = (spaceId: string) => {
    const newPage: DocumentPage = {
      id: `page-${Date.now()}`,
      spaceId,
      title: 'Untitled Document',
      content: '# Untitled Document\n\nWrite your thoughts or ask an AI Coworker to collaborate...',
      icon: 'file-text',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      tags: ['draft'],
    };

    const updatedSpaces = spaces.map((s) =>
      s.id === spaceId ? { ...s, pages: [newPage, ...s.pages] } : s
    );

    persistSpaces(updatedSpaces);
    setActivePageId(newPage.id);
  };

  const handleUpdatePage = (spaceId: string, pageId: string, updates: Partial<DocumentPage>) => {
    const updatedSpaces = spaces.map((s) => {
      if (s.id !== spaceId) return s;
      return {
        ...s,
        pages: s.pages.map((p) => (p.id === pageId ? { ...p, ...updates } : p)),
      };
    });
    persistSpaces(updatedSpaces);
  };

  const handleDeletePage = (spaceId: string, pageId: string) => {
    const updatedSpaces = spaces.map((s) => {
      if (s.id !== spaceId) return s;
      return {
        ...s,
        pages: s.pages.filter((p) => p.id !== pageId),
      };
    });
    persistSpaces(updatedSpaces);
    if (activePageId === pageId) {
      setActivePageId(null);
    }
  };

  const handleAskAgentAboutPage = (agentId: string, page: DocumentPage) => {
    setActiveAgentId(agentId);
    setActiveView('agent');
    handleSendMessage(`Please review this document from Space: "${page.title}". Here is the content:\n\n${page.content.slice(0, 300)}...\n\nCan you analyze it and suggest improvements or next sections?`);
  };

  // MCP Tool Handlers
  const handleToggleMcpTool = (toolId: string) => {
    setMcpTools((prev) =>
      prev.map((t) => (t.id === toolId ? { ...t, enabled: !t.enabled } : t))
    );
  };

  const handleToggleMcpApproval = (toolId: string) => {
    setMcpTools((prev) =>
      prev.map((t) => (t.id === toolId ? { ...t, requiresApproval: !t.requiresApproval } : t))
    );
  };

  const handleAddCustomMcpTool = (newTool: MCPTool) => {
    setMcpTools((prev) => [newTool, ...prev]);
  };

  // Active selections
  const currentAgent = agents.find((a) => a.id === activeAgentId) || agents[0];
  const currentSpace = spaces.find((s) => s.id === activeSpaceId) || spaces[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0a0a0a] text-zinc-100 font-sans antialiased selection:bg-white selection:text-black">
      {/* Primary Sidebar */}
      <Sidebar
        spaces={spaces}
        agents={agents}
        activeSpaceId={activeSpaceId}
        activeAgentId={activeAgentId}
        activeView={activeView}
        onSelectSpace={handleSelectSpace}
        onSelectAgent={handleSelectAgent}
        onSelectView={setActiveView}
        onOpenNewAgentModal={() => setIsAgentModalOpen(true)}
        onOpenNewSpaceModal={() => setIsSpaceModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      {/* Main Viewport Container */}
      <main key={activeView} className="flex-1 flex overflow-hidden view-enter">
        {/* VIEW 1: AGENT CONVERSATION */}
        {activeView === 'agent' && (
          <AgentChat
            agent={currentAgent}
            messages={messages[currentAgent.id] || []}
            isLoading={isAgentResponding}
            onSendMessage={handleSendMessage}
            onApproveReview={handleApproveReview}
            onDeclineReview={handleDeclineReview}
            onSwitchToComputer={() => setActiveView('computer')}
            onViewSavedPage={(pageId) => {
              setActiveView('space');
              setActivePageId(pageId);
            }}
          />
        )}

        {/* VIEW 2: SPACES & DOCUMENT WORKSPACE */}
        {activeView === 'space' && (
          <SpaceWorkspace
            space={currentSpace}
            agents={agents}
            activePageId={activePageId}
            onSelectPage={setActivePageId}
            onCreatePage={handleCreatePage}
            onUpdatePage={handleUpdatePage}
            onDeletePage={handleDeletePage}
            onAskAgentAboutPage={handleAskAgentAboutPage}
          />
        )}

        {/* VIEW 3: AGENT COMPUTERS */}
        {activeView === 'computer' && (
          <NookComputer
            agents={agents}
            activeAgentId={activeAgentId}
            computerStates={computerStates}
            onSelectAgent={setActiveAgentId}
            onUpdateComputerState={handleUpdateComputerState}
            onExecuteTerminalCommand={handleExecuteTerminalCommand}
          />
        )}

        {/* VIEW 4: MCP TOOLS & CONNECTIONS */}
        {activeView === 'tools' && (
          <McpManager
            tools={mcpTools}
            agents={agents}
            onToggleTool={handleToggleMcpTool}
            onToggleApproval={handleToggleMcpApproval}
            onAddCustomTool={handleAddCustomMcpTool}
          />
        )}
      </main>

      {/* Modals */}
      <AgentModal
        isOpen={isAgentModalOpen}
        onClose={() => setIsAgentModalOpen(false)}
        onSaveAgent={(agent) => persistAgents([...agents, agent])}
        availableTools={mcpTools}
        availableSpaces={spaces}
      />

      <SpaceModal
        isOpen={isSpaceModalOpen}
        onClose={() => setIsSpaceModalOpen(false)}
        onSaveSpace={(space) => persistSpaces([...spaces, space])}
        availableAgents={agents}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={llmSettings}
        onSaveSettings={persistSettings}
        onExportWorkspace={() => {
          const backup = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            agents,
            spaces,
            computerStates,
            mcpTools,
            llmSettings,
          };
          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `nook-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}
        onResetWorkspace={() => {
          try {
            localStorage.removeItem('nook_agents');
            localStorage.removeItem('nook_spaces');
            localStorage.removeItem('nook_settings');
          } catch {}
          setAgents(INITIAL_AGENTS);
          setSpaces(INITIAL_SPACES);
          setComputerStates(INITIAL_COMPUTER_STATES);
          setLlmSettings(DEFAULT_LLM_SETTINGS);
          setIsSettingsModalOpen(false);
        }}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        agents={agents}
        spaces={spaces}
        onSelectAgent={handleSelectAgent}
        onSelectSpace={handleSelectSpace}
        onSelectView={setActiveView}
        onOpenNewAgentModal={() => setIsAgentModalOpen(true)}
        onOpenNewSpaceModal={() => setIsSpaceModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
      />
    </div>
  );
}
