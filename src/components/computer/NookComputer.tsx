'use client';

import React, { useState } from 'react';
import { Agent, ComputerState, VirtualFile } from '@/types';
import { 
  Globe, 
  Terminal as TerminalIcon, 
  FolderTree, 
  Activity, 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  Lock, 
  UserCheck, 
  Bot, 
  Play, 
  FileCode, 
  Check, 
  Copy,
  ExternalLink,
  ShieldCheck,
  Maximize2,
  Plus,
  Trash2,
  Save,
  Smartphone,
  Tablet,
  Monitor,
  Star
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { AgentArchetypeIcon } from '@/components/ui/ArchetypeIcon';


interface NookComputerProps {
  agents: Agent[];
  activeAgentId: string;
  computerStates: Record<string, ComputerState>;
  onSelectAgent: (agentId: string) => void;
  onUpdateComputerState: (agentId: string, updates: Partial<ComputerState>) => void;
  onExecuteTerminalCommand: (agentId: string, command: string) => void;
}

export const NookComputer: React.FC<NookComputerProps> = ({
  agents,
  activeAgentId,
  computerStates,
  onSelectAgent,
  onUpdateComputerState,
  onExecuteTerminalCommand,
}) => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'browser' | 'terminal' | 'files' | 'activity'>('browser');
  const [browserInputUrl, setBrowserInputUrl] = useState('');
  const [terminalInput, setTerminalInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<VirtualFile | null>(null);
  const [editedFileContent, setEditedFileContent] = useState('');
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [viewportMode, setViewportMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [copiedFile, setCopiedFile] = useState(false);
  const [fileSaveSuccess, setFileSaveSuccess] = useState(false);

  const getFileIconColor = (name: string) => {
    return 'text-neutral-400';
  };


  const currentAgent = agents.find((a) => a.id === activeAgentId) || agents[0];
  const currentState = computerStates[currentAgent.id] || {
    agentId: currentAgent.id,
    url: 'https://github.com/CopilotKit/OpenDots',
    pageTitle: 'GitHub - CopilotKit/OpenDots',
    isLoading: false,
    takeoverMode: false,
    history: ['https://github.com/CopilotKit/OpenDots'],
    historyIndex: 0,
    terminalLogs: [],
    files: [],
    activityLogs: [],
  };

  const [scrapedPageData, setScrapedPageData] = useState<{
    title?: string;
    description?: string;
    headings?: string[];
    readableText?: string;
  } | null>(null);

  const currentUrl = browserInputUrl || currentState.url;

  const handleNavigate = async (e?: React.FormEvent, customUrl?: string) => {
    if (e) e.preventDefault();
    const urlToUse = customUrl || browserInputUrl || currentState.url;
    if (!urlToUse || !urlToUse.trim()) return;

    const formattedUrl = urlToUse.startsWith('http') 
      ? urlToUse 
      : `https://${urlToUse}`;
    setBrowserInputUrl(formattedUrl);

    onUpdateComputerState(currentAgent.id, {
      isLoading: true,
      url: formattedUrl,
      pageTitle: `Loading ${formattedUrl}...`,
      history: [...currentState.history.slice(0, currentState.historyIndex + 1), formattedUrl],
      historyIndex: currentState.historyIndex + 1,
    });

    try {
      const res = await fetch('/api/sandbox/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formattedUrl }),
      });
      const data = await res.json();
      setScrapedPageData(data);

      onUpdateComputerState(currentAgent.id, {
        isLoading: false,
        url: formattedUrl,
        pageTitle: data.title || formattedUrl,
        activityLogs: [
          {
            id: `act-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            action: 'Web Scrape',
            details: `Scraped ${formattedUrl} (${data.headings?.length || 0} headings extracted)`,
          },
          ...currentState.activityLogs,
        ],
      });
      toast.success('Page Loaded', `Scraped ${data.title || formattedUrl}`);
    } catch {
      onUpdateComputerState(currentAgent.id, {
        isLoading: false,
        url: formattedUrl,
        pageTitle: formattedUrl,
      });
    }
  };

  const handleBack = () => {
    if (currentState.historyIndex > 0) {
      const prevIndex = currentState.historyIndex - 1;
      const prevUrl = currentState.history[prevIndex];
      onUpdateComputerState(currentAgent.id, {
        historyIndex: prevIndex,
        url: prevUrl,
        pageTitle: `Browsing ${prevUrl}`,
      });
      setBrowserInputUrl(prevUrl);
    }
  };

  const handleForward = () => {
    if (currentState.historyIndex < currentState.history.length - 1) {
      const nextIndex = currentState.historyIndex + 1;
      const nextUrl = currentState.history[nextIndex];
      onUpdateComputerState(currentAgent.id, {
        historyIndex: nextIndex,
        url: nextUrl,
        pageTitle: `Browsing ${nextUrl}`,
      });
      setBrowserInputUrl(nextUrl);
    }
  };

  const handleRefresh = () => {
    handleNavigate(undefined, currentState.url);
  };

  const handleTerminalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim()) return;
    onExecuteTerminalCommand(currentAgent.id, terminalInput.trim());
    setTerminalInput('');
  };

  const handleToggleTakeover = () => {
    onUpdateComputerState(currentAgent.id, {
      takeoverMode: !currentState.takeoverMode,
    });
  };

  const handleClearTerminal = () => {
    onUpdateComputerState(currentAgent.id, {
      terminalLogs: [
        { id: `term-clear-${Date.now()}`, type: 'system', text: 'Terminal cleared by user.', timestamp: new Date().toLocaleTimeString() }
      ]
    });
  };

  const handleQuickCommand = (cmd: string) => {
    onExecuteTerminalCommand(currentAgent.id, cmd);
  };

  const handleSelectFile = (file: VirtualFile) => {
    setSelectedFile(file);
    setEditedFileContent(file.content);
  };

  const handleSaveFileContent = () => {
    if (!selectedFile) return;
    const updatedFiles = currentState.files.map((f) =>
      f.path === selectedFile.path ? { ...f, content: editedFileContent, updatedAt: 'Just now' } : f
    );
    onUpdateComputerState(currentAgent.id, {
      files: updatedFiles,
    });
    setSelectedFile({ ...selectedFile, content: editedFileContent });
    setFileSaveSuccess(true);
    toast.success('File Saved', `Updated ${selectedFile.name} in /workspace.`);
    setTimeout(() => setFileSaveSuccess(false), 2000);
  };

  const handleCreateVirtualFile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    const cleanName = newFileName.trim();
    const newPath = `/workspace/${cleanName}`;
    const newFile: VirtualFile = {
      path: newPath,
      name: cleanName,
      content: `# ${cleanName}\nCreated in agent computer workspace.`,
      size: '120 B',
      updatedAt: 'Just now',
      type: 'file',
    };
    onUpdateComputerState(currentAgent.id, {
      files: [...currentState.files, newFile],
    });
    setSelectedFile(newFile);
    setEditedFileContent(newFile.content);
    setNewFileName('');
    setIsCreatingFile(false);
    toast.success('File Created', `Added ${cleanName} to /workspace.`);
  };

  const handleDeleteVirtualFile = (path: string) => {
    const updatedFiles = currentState.files.filter((f) => f.path !== path);
    onUpdateComputerState(currentAgent.id, {
      files: updatedFiles,
    });
    const filename = path.split('/').pop() || path;
    toast.warning('File Deleted', `${filename} was removed from /workspace.`);
    if (selectedFile?.path === path) {
      setSelectedFile(null);
    }
  };

  const copyFileContent = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedFile(true);
    toast.info('Copied File Content', 'Raw file content copied to clipboard.');
    setTimeout(() => setCopiedFile(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#0d0d0d] text-neutral-200 overflow-hidden">
      {/* Computer Top Header */}
      <div className="h-14 px-4 border-b border-white/[0.08] bg-[#0a0a0d] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <AgentArchetypeIcon name={currentAgent.name} avatarKey={currentAgent.avatar} size="md" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-sm">{currentAgent.name}&apos;s Computer</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-neutral-300 border border-white/[0.08] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  sandbox/{currentAgent.id}
                </span>
              </div>
            </div>
          </div>

          {/* Agent Switcher Quick Dropdown */}
          <div className="flex items-center gap-1 bg-[#121216] p-1 rounded-xl border border-white/[0.08] ml-4">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={`px-2.5 py-1 rounded-lg text-xs transition-all flex items-center gap-2 ${
                  agent.id === currentAgent.id
                    ? 'bg-white/[0.12] text-white font-medium shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <AgentArchetypeIcon name={agent.name} avatarKey={agent.avatar} size="xs" />
                <span>{agent.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab Switcher & Human Takeover Toggle */}
        <div className="flex items-center gap-3">
          {/* View Tabs */}
          <div className="flex items-center gap-0.5 bg-[#141414] p-0.5 rounded-lg border border-white/[0.08]">
            <button
              onClick={() => setActiveTab('browser')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === 'browser'
                  ? 'bg-white/[0.12] text-white font-medium'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-neutral-300" />
              Browser
            </button>

            <button
              onClick={() => setActiveTab('terminal')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === 'terminal'
                  ? 'bg-white/[0.12] text-white font-medium'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <TerminalIcon className="w-3.5 h-3.5 text-neutral-300" />
              Terminal
            </button>

            <button
              onClick={() => setActiveTab('files')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === 'files'
                  ? 'bg-white/[0.12] text-white font-medium'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5 text-neutral-300" />
              Files ({currentState.files.length})
            </button>

            <button
              onClick={() => setActiveTab('activity')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === 'activity'
                  ? 'bg-white/[0.12] text-white font-medium'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-neutral-300" />
              Activity
            </button>
          </div>

          {/* Takeover Control */}
          <button
            onClick={handleToggleTakeover}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-all ${
              currentState.takeoverMode
                ? 'bg-white text-black border-white shadow-sm font-semibold'
                : 'bg-white/[0.04] border-white/[0.08] text-neutral-300 hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            {currentState.takeoverMode ? (
              <>
                <UserCheck className="w-3.5 h-3.5 text-black" />
                <span>Human Takeover</span>
              </>
            ) : (
              <>
                <Bot className="w-3.5 h-3.5 text-neutral-400" />
                <span>Autonomous</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Tab View Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Human Takeover vs Autonomous Supervisor Status Banner */}
        {currentState.takeoverMode ? (
          <div className="px-4 py-2 bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent border-b border-amber-500/30 flex items-center justify-between text-xs animate-fade-in shrink-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <span className="font-semibold text-amber-300">Human Takeover Active</span>
              <span className="text-neutral-400 text-[11px] hidden sm:inline">
                • Manual keyboard, terminal input, and browser controls enabled. Autonomous agent actions paused.
              </span>
            </div>
            <button
              onClick={handleToggleTakeover}
              className="text-[11px] px-2.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 transition-colors font-medium cursor-pointer"
            >
              Release Control to Coworker
            </button>
          </div>
        ) : (
          <div className="px-4 py-1.5 bg-black/40 border-b border-white/[0.06] flex items-center justify-between text-xs text-neutral-400 font-mono shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Autonomous Supervisor Active • Sandbox Container Isolated</span>
            </div>
            <button
              onClick={handleToggleTakeover}
              className="text-[11px] text-neutral-400 hover:text-white transition-colors underline underline-offset-2 cursor-pointer"
            >
              Takeover Session
            </button>
          </div>
        )}

        {/* ================= BROWSER VIEW ================= */}
        {activeTab === 'browser' && (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#0d0d0d]">
            {/* Browser Navigation Bar */}
            <div className="px-4 py-2 border-b border-white/[0.08] bg-[#141414] flex items-center gap-3">
              <div className="flex items-center gap-1 text-neutral-400">
                <button 
                  onClick={handleBack}
                  disabled={currentState.historyIndex <= 0}
                  className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
                  title="Back"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={handleForward}
                  disabled={currentState.historyIndex >= currentState.history.length - 1}
                  className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
                  title="Forward"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={handleRefresh}
                  className="p-1 rounded hover:bg-white/[0.06] transition-colors"
                  title="Refresh"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${currentState.isLoading ? 'animate-spin text-white' : ''}`} />
                </button>
              </div>

              {/* URL Bar */}
              <form onSubmit={handleNavigate} className="flex-1 flex items-center gap-2 px-3.5 py-1.5 rounded-xl glass-input border border-white/[0.08] text-xs focus-within:border-white/30 transition-colors">
                <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
                <input
                  type="text"
                  value={currentUrl}
                  onChange={(e) => setBrowserInputUrl(e.target.value)}
                  placeholder="Enter URL to navigate or inspect (e.g. news.ycombinator.com)..."
                  className="bg-transparent border-none outline-none text-white placeholder:text-neutral-500 w-full font-mono text-xs"
                />
                <button type="submit" className="p-1 rounded hover:bg-white/[0.08] text-neutral-400 hover:text-white transition-colors" title="Navigate">
                  <Play className="w-3 h-3" />
                </button>
              </form>

              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <div className="flex items-center glass-panel p-0.5 rounded-xl border border-white/[0.08]">
                  <button
                    onClick={() => setViewportMode('desktop')}
                    title="Desktop View (1920x1080)"
                    className={`p-1.5 rounded-lg transition-all ${viewportMode === 'desktop' ? 'bg-white text-black font-semibold shadow-sm' : 'text-neutral-400 hover:text-white'}`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewportMode('tablet')}
                    title="Tablet View (768px)"
                    className={`p-1.5 rounded-lg transition-all ${viewportMode === 'tablet' ? 'bg-white text-black font-semibold shadow-sm' : 'text-neutral-400 hover:text-white'}`}
                  >
                    <Tablet className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewportMode('mobile')}
                    title="Mobile View (375px)"
                    className={`p-1.5 rounded-lg transition-all ${viewportMode === 'mobile' ? 'bg-white text-black font-semibold shadow-sm' : 'text-neutral-400 hover:text-white'}`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </button>
                </div>

                <a
                  href={currentState.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded hover:bg-white/[0.06] text-neutral-400 hover:text-white transition-colors"
                  title="Open external browser tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Viewport Render Frame */}
            <div className="flex-1 p-4 overflow-y-auto flex flex-col items-center animate-fade-in">
              <div className={`w-full transition-all duration-300 rounded-xl border border-white/[0.1] bg-[#141414] shadow-sm overflow-hidden flex flex-col min-h-[520px] ${
                viewportMode === 'mobile' ? 'max-w-sm' : viewportMode === 'tablet' ? 'max-w-2xl' : 'max-w-5xl'
              }`}>
                {/* Simulated Web Viewport Header */}
                <div className="px-4 py-2 bg-[#18181b] border-b border-white/[0.08] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                    <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                    <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                    <span className="ml-2 font-medium text-neutral-300 truncate max-w-md">{currentState.pageTitle}</span>
                  </div>

                  {currentState.takeoverMode && (
                    <span className="px-2 py-0.5 rounded bg-white text-black font-mono text-[10px] font-semibold animate-pulse">
                      INTERACTIVE HUMAN MODE
                    </span>
                  )}
                </div>

                {/* Simulated Web Page Content */}
                <div className="flex-1 p-6 space-y-6 text-neutral-200">
                  {currentState.isLoading ? (
                    <div className="space-y-6 py-12 flex flex-col items-center justify-center animate-fade-in">
                      <div className="flex items-center gap-2">
                        <span className="chatgpt-dot chatgpt-dot-1" />
                        <span className="chatgpt-dot chatgpt-dot-2" />
                        <span className="chatgpt-dot chatgpt-dot-3" />
                      </div>
                      <p className="text-xs font-mono text-neutral-400 animate-pulse">
                        Fetching DOM stream from {currentState.url}...
                      </p>
                      <div className="w-full max-w-md space-y-2.5">
                        <div className="h-4 bg-white/[0.06] rounded animate-pulse" />
                        <div className="h-4 bg-white/[0.04] rounded w-5/6 animate-pulse" />
                        <div className="h-4 bg-white/[0.03] rounded w-2/3 animate-pulse" />
                      </div>
                    </div>
                  ) : scrapedPageData ? (
                    <div className="space-y-6 animate-fade-in">
                      <div className="border-b border-white/[0.08] pb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-white" />
                            <h2 className="text-base font-bold text-white tracking-tight">{scrapedPageData.title || currentState.url}</h2>
                          </div>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-neutral-300 border border-white/[0.08]">
                            Live Scraped DOM
                          </span>
                        </div>
                        {scrapedPageData.description && (
                          <p className="text-xs text-neutral-400 mt-2 leading-relaxed">{scrapedPageData.description}</p>
                        )}
                      </div>

                      {scrapedPageData.headings && scrapedPageData.headings.length > 0 && (
                        <div className="p-4 rounded-lg bg-[#0d0d0d] border border-white/[0.06] space-y-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                            Extracted Headings ({scrapedPageData.headings.length})
                          </span>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {scrapedPageData.headings.slice(0, 10).map((h, i) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-white/[0.04] text-neutral-300 border border-white/[0.06]">
                                {h}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {scrapedPageData.readableText && (
                        <div className="p-4 rounded-lg bg-[#0d0d0d] border border-white/[0.06] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                              Readable Text Excerpt
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(scrapedPageData.readableText || '');
                                toast.info('Copied', 'Extracted page content copied to clipboard.');
                              }}
                              className="text-[10px] text-neutral-400 hover:text-white transition-colors"
                            >
                              Copy Text
                            </button>
                          </div>
                          <p className="text-xs text-neutral-300 leading-relaxed font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {scrapedPageData.readableText.slice(0, 800)}...
                          </p>
                        </div>
                      )}
                    </div>
                  ) : currentState.url.includes('github.com/CopilotKit/OpenDots') ? (
                    <div className="space-y-4 animate-fade-in">
                      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white text-black flex items-center justify-center font-bold text-sm">
                            <div className="w-2.5 h-2.5 rounded-full bg-black" />
                          </div>
                          <div>
                            <h2 className="text-base font-bold text-white tracking-tight">CopilotKit / OpenDots</h2>
                            <p className="text-xs text-neutral-400">Autonomous AI coworkers with persistent computers & spaces.</p>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-md bg-white/[0.05] border border-white/[0.08] text-xs font-mono text-neutral-300 flex items-center gap-1.5">
                          <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                          <span>2,450 Stars</span>
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-3.5 rounded-lg bg-[#0d0d0d] border border-white/[0.06]">
                          <span className="text-white text-xs font-semibold">Specialist Dots</span>
                          <p className="text-[11px] text-neutral-400 mt-1">Autonomous agents with specialist roles, tools, and sandboxes.</p>
                        </div>
                        <div className="p-3.5 rounded-lg bg-[#0d0d0d] border border-white/[0.06]">
                          <span className="text-white text-xs font-semibold">Dot Computers</span>
                          <p className="text-[11px] text-neutral-400 mt-1">Container supervisor with isolated web scraper and shell.</p>
                        </div>
                        <div className="p-3.5 rounded-lg bg-[#0d0d0d] border border-white/[0.06]">
                          <span className="text-white text-xs font-semibold">Spaces & Review</span>
                          <p className="text-[11px] text-neutral-400 mt-1">Review cards for draft pages and shell commands before commit.</p>
                        </div>
                      </div>

                      <div className="p-4 rounded-lg bg-[#0a0a0a] border border-white/[0.06] font-mono text-xs text-neutral-300 space-y-2">
                        <p className="text-neutral-500"># Clone and launch</p>
                        <p className="text-white">git clone https://github.com/CopilotKit/OpenDots.git</p>
                        <p className="text-neutral-500"># Install dependencies and run locally</p>
                        <p className="text-white">npm install &amp;&amp; npm run dev</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 animate-fade-in">
                      <div className="flex items-center gap-2 text-white">
                        <Globe className="w-5 h-5 text-neutral-400" />
                        <h2 className="text-lg font-bold text-white">{currentState.pageTitle}</h2>
                      </div>
                      <p className="text-xs text-neutral-300">
                        Inspecting URL: <span className="text-white font-mono">{currentState.url}</span>
                      </p>
                      <div className="p-4 rounded-lg bg-[#0d0d0d] border border-white/[0.08] text-xs text-neutral-400">
                        DOM stream parsed. Headings, semantic anchors, and readable text extracted into workspace context.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TERMINAL VIEW ================= */}
        {activeTab === 'terminal' && (
          <div className="flex-1 flex flex-col overflow-hidden bg-black font-mono text-xs text-neutral-200 animate-fade-in">
            {/* Terminal Header */}
            <div className="px-4 py-2 bg-[#141414] border-b border-white/[0.08] flex items-center justify-between text-neutral-400 text-[11px]">
              <div className="flex items-center gap-2">
                <TerminalIcon className="w-3.5 h-3.5 text-white" />
                <span>nook@{currentAgent.id}:/workspace</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleClearTerminal}
                  className="text-neutral-400 hover:text-white text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] transition-colors"
                >
                  Clear Console
                </button>
                <span className="text-neutral-400">STATUS: READY (BASH 5.2)</span>
              </div>
            </div>

            {/* Quick Command Chips */}
            <div className="px-4 py-1.5 bg-[#0d0d0d] border-b border-white/[0.04] flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[11px]">
              <span className="text-neutral-500 text-[10px] mr-1">Quick:</span>
              {['ls -la', 'npm test', 'git status', 'pwd', 'whoami', 'date'].map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => handleQuickCommand(cmd)}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-neutral-300 hover:text-white border border-white/[0.06] text-[10px] transition-colors active:scale-95"
                >
                  ${cmd}
                </button>
              ))}
            </div>

            {/* Terminal Output Logs */}
            <div className="flex-1 p-4 overflow-y-auto space-y-2 scrollbar-thin">
              {currentState.terminalLogs.map((log) => (
                <div key={log.id} className="leading-relaxed animate-slide-up">
                  {log.type === 'system' && (
                    <p className="text-neutral-500">[SYSTEM] {log.text}</p>
                  )}
                  {log.type === 'input' && (
                    <div className="flex items-center gap-2 text-white">
                      <span className="text-neutral-400 font-bold">$</span>
                      <span>{log.text}</span>
                    </div>
                  )}
                  {log.type === 'output' && (
                    <pre className="text-neutral-300 whitespace-pre-wrap pl-4 border-l border-white/[0.1]">{log.text}</pre>
                  )}
                  {log.type === 'error' && (
                    <pre className="text-red-400 whitespace-pre-wrap pl-4 border-l border-red-500/30">{log.text}</pre>
                  )}
                </div>
              ))}
            </div>

            {/* Terminal Interactive Input */}
            <form onSubmit={handleTerminalSubmit} className="p-3 bg-[#141414] border-t border-white/[0.08] flex items-center gap-2">
              <span className="text-white font-bold">$</span>
              <input
                type="text"
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                placeholder="Type command (e.g. ls -la, npm test, cat /workspace/deploy.sh)..."
                className="bg-transparent border-none outline-none text-white placeholder:text-neutral-500 flex-1 font-mono text-xs"
              />
              <button type="submit" className="px-3 py-1 bg-white hover:bg-neutral-200 text-black font-semibold rounded text-xs transition-colors active:scale-95">
                Run
              </button>
            </form>
          </div>
        )}

        {/* ================= FILES VIEW ================= */}
        {activeTab === 'files' && (
          <div className="flex-1 flex overflow-hidden bg-[#0d0d0d] animate-fade-in">
            {/* File List */}
            <div className="w-72 border-r border-white/[0.08] bg-[#141414] p-3 flex flex-col shrink-0">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  Files (/workspace)
                </span>
                <button
                  onClick={() => setIsCreatingFile(!isCreatingFile)}
                  className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  title="Create New File"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {isCreatingFile && (
                <form onSubmit={handleCreateVirtualFile} className="mb-2 p-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] space-y-2">
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="filename.md"
                    className="w-full px-2 py-1 rounded bg-[#141414] border border-white/[0.1] text-xs text-white outline-none font-mono"
                    autoFocus
                  />
                  <div className="flex items-center gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsCreatingFile(false)}
                      className="px-2 py-0.5 rounded text-[10px] text-neutral-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-2 py-0.5 rounded bg-white hover:bg-neutral-200 text-black text-[10px] font-semibold"
                    >
                      Create
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-1 flex-1 overflow-y-auto">
                {currentState.files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => handleSelectFile(file)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between group transition-colors ${
                      selectedFile?.path === file.path
                        ? 'bg-white/[0.1] text-white font-medium border border-white/20'
                        : 'hover:bg-white/[0.04] text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCode className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="truncate">{file.name}</span>
                    </div>
                    <span className="text-[10px] text-neutral-500 font-mono">{file.size}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* File Content Preview & Live Editor */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0d0d0d]">
              {selectedFile ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/[0.08] bg-[#141414] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <FileCode className="w-4 h-4 text-neutral-400" />
                      <span className="font-mono text-white">{selectedFile.path}</span>
                      <span className="text-neutral-500 text-[10px]">({selectedFile.size})</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveFileContent}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white hover:bg-neutral-200 text-black text-xs transition-colors font-semibold shadow-sm"
                      >
                        {fileSaveSuccess ? <Check className="w-3.5 h-3.5 text-black" /> : <Save className="w-3.5 h-3.5" />}
                        <span>{fileSaveSuccess ? 'Saved' : 'Save'}</span>
                      </button>

                      <button
                        onClick={() => copyFileContent(editedFileContent)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-xs text-neutral-300 hover:text-white transition-colors border border-white/[0.08]"
                      >
                        {copiedFile ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedFile ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        onClick={() => {
                          if (confirm(`Delete file "${selectedFile.name}"?`)) {
                            handleDeleteVirtualFile(selectedFile.path);
                          }
                        }}
                        className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete File"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-neutral-300 flex flex-col">
                    <textarea
                      value={editedFileContent}
                      onChange={(e) => setEditedFileContent(e.target.value)}
                      className="w-full flex-1 bg-transparent border-none outline-none resize-none font-mono text-xs leading-relaxed text-neutral-200"
                      placeholder="File content..."
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-neutral-500 text-xs font-mono">
                  Select a file from the workspace tree to view or edit.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= ACTIVITY VIEW ================= */}
        {activeTab === 'activity' && (
          <div className="flex-1 p-6 overflow-y-auto bg-[#0d0d0d] animate-fade-in">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <h3 className="text-sm font-semibold text-white">Agent Computer Activity Stream</h3>
                <span className="text-xs text-neutral-400">Total Events: {currentState.activityLogs.length}</span>
              </div>

              <div className="space-y-3">
                {currentState.activityLogs.map((act) => (
                  <div key={act.id} className="p-3 rounded-lg bg-[#141414] border border-white/[0.08] flex items-start justify-between animate-slide-up hover:border-white/20 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-white/[0.06] text-neutral-300 font-mono text-[10px] font-semibold border border-white/[0.08]">
                          {act.action}
                        </span>
                        <span className="text-xs text-neutral-200 font-medium">{act.details}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-neutral-500 font-mono shrink-0 ml-4">{act.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
