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
  Monitor
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';


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
    if (name.endsWith('.sh') || name.endsWith('.bash')) return 'text-emerald-400';
    if (name.endsWith('.py')) return 'text-amber-400';
    if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js')) return 'text-blue-400';
    if (name.endsWith('.json')) return 'text-yellow-400';
    if (name.endsWith('.md')) return 'text-purple-400';
    return 'text-indigo-400';
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

  const currentUrl = browserInputUrl || currentState.url;

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!browserInputUrl.trim()) return;
    const formattedUrl = browserInputUrl.startsWith('http') 
      ? browserInputUrl 
      : `https://${browserInputUrl}`;

    onUpdateComputerState(currentAgent.id, {
      url: formattedUrl,
      pageTitle: `Browsing ${formattedUrl}`,
      history: [...currentState.history, formattedUrl],
      historyIndex: currentState.history.length,
      activityLogs: [
        {
          id: `act-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          action: 'Manual Navigation',
          details: `User navigated to ${formattedUrl}`,
        },
        ...currentState.activityLogs,
      ],
    });
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
    <div className="flex-1 flex flex-col h-screen bg-[#090d14] text-slate-200 overflow-hidden">
      {/* Computer Top Header */}
      <div className="h-14 px-4 border-b border-white/[0.08] bg-[#0c111a] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">{currentAgent.avatar}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-sm">{currentAgent.name}&apos;s Computer</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Container: {currentAgent.id}
                </span>
              </div>
            </div>
          </div>

          {/* Agent Switcher Quick Dropdown */}
          <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-lg border border-white/[0.08] ml-4">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={`px-2 py-1 rounded text-xs transition-colors flex items-center gap-1.5 ${
                  agent.id === currentAgent.id
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <span>{agent.avatar}</span>
                <span>{agent.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab Switcher & Human Takeover Toggle */}
        <div className="flex items-center gap-3">
          {/* View Tabs */}
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/[0.08]">
            <button
              onClick={() => setActiveTab('browser')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === 'browser'
                  ? 'bg-white/[0.12] text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              Browser
            </button>

            <button
              onClick={() => setActiveTab('terminal')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === 'terminal'
                  ? 'bg-white/[0.12] text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TerminalIcon className="w-3.5 h-3.5 text-amber-400" />
              Terminal
            </button>

            <button
              onClick={() => setActiveTab('files')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === 'files'
                  ? 'bg-white/[0.12] text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5 text-emerald-400" />
              Files ({currentState.files.length})
            </button>

            <button
              onClick={() => setActiveTab('activity')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === 'activity'
                  ? 'bg-white/[0.12] text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-purple-400" />
              Activity
            </button>
          </div>

          {/* Takeover Control */}
          <button
            onClick={handleToggleTakeover}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all ${
              currentState.takeoverMode
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-md shadow-amber-950/30 ring-1 ring-amber-500/30'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            {currentState.takeoverMode ? (
              <>
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>Human Takeover Active</span>
              </>
            ) : (
              <>
                <Bot className="w-3.5 h-3.5 text-slate-400" />
                <span>Agent Control (Autonomous)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Tab View Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ================= BROWSER VIEW ================= */}
        {activeTab === 'browser' && (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#070b11]">
            {/* Browser Navigation Bar */}
            <div className="px-4 py-2 border-b border-white/[0.08] bg-[#0d121c] flex items-center gap-3">
              <div className="flex items-center gap-1 text-slate-400">
                <button 
                  disabled={currentState.historyIndex <= 0}
                  className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-40"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <button 
                  disabled={currentState.historyIndex >= currentState.history.length - 1}
                  className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-40"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button className="p-1 rounded hover:bg-white/[0.06]">
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* URL Bar */}
              <form onSubmit={handleNavigate} className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.08] text-xs">
                <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
                <input
                  type="text"
                  value={currentUrl}
                  onChange={(e) => setBrowserInputUrl(e.target.value)}
                  placeholder="Enter URL to navigate or inspect..."
                  className="bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-500 w-full font-mono text-xs"
                />
                <button type="submit" className="text-slate-400 hover:text-white">
                  <Play className="w-3 h-3" />
                </button>
              </form>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <div className="flex items-center bg-black/40 p-0.5 rounded-lg border border-white/[0.08]">
                  <button
                    onClick={() => setViewportMode('desktop')}
                    title="Desktop View (1920x1080)"
                    className={`p-1 rounded ${viewportMode === 'desktop' ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewportMode('tablet')}
                    title="Tablet View (768px)"
                    className={`p-1 rounded ${viewportMode === 'tablet' ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    <Tablet className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewportMode('mobile')}
                    title="Mobile View (375px)"
                    className={`p-1 rounded ${viewportMode === 'mobile' ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </button>
                </div>

                <a
                  href={currentState.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded hover:bg-white/[0.06] text-slate-400 hover:text-white"
                  title="Open external browser tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Viewport Render Frame */}
            <div className="flex-1 p-4 overflow-y-auto flex flex-col items-center">
              <div className={`w-full transition-all duration-300 rounded-xl border border-white/[0.1] bg-[#0f1724] shadow-2xl overflow-hidden flex flex-col min-h-[520px] ${
                viewportMode === 'mobile' ? 'max-w-sm' : viewportMode === 'tablet' ? 'max-w-2xl' : 'max-w-5xl'
              }`}>
                {/* Simulated Web Viewport Header */}
                <div className="px-4 py-2 bg-[#141d2e] border-b border-white/[0.08] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                    <span className="ml-2 font-medium text-slate-300 truncate max-w-md">{currentState.pageTitle}</span>
                  </div>

                  {currentState.takeoverMode && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] border border-amber-500/30">
                      INTERACTIVE HUMAN MODE
                    </span>
                  )}
                </div>

                {/* Simulated Web Page Content */}
                <div className="flex-1 p-6 space-y-6 text-slate-200">
                  {currentState.url.includes('github.com/CopilotKit/OpenDots') ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white">
                            OD
                          </div>
                          <div>
                            <h2 className="text-base font-bold text-white">CopilotKit / OpenDots</h2>
                            <p className="text-xs text-slate-400">Your always-on AI coworkers that move between text, calls, and Slack.</p>
                          </div>
                        </div>
                        <span className="px-2 py-1 rounded bg-white/[0.05] border border-white/[0.08] text-xs font-mono text-slate-300">
                          ★ 2,450 Stars
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-3.5 rounded-lg bg-black/30 border border-white/[0.06]">
                          <span className="text-emerald-400 text-xs font-semibold">Specialist Dots</span>
                          <p className="text-[11px] text-slate-400 mt-1">Define autonomous agents with roles, tools, and permissions.</p>
                        </div>
                        <div className="p-3.5 rounded-lg bg-black/30 border border-white/[0.06]">
                          <span className="text-blue-400 text-xs font-semibold">Dot Computers</span>
                          <p className="text-[11px] text-slate-400 mt-1">OpenBot container supervisor with isolated browser and shell.</p>
                        </div>
                        <div className="p-3.5 rounded-lg bg-black/30 border border-white/[0.06]">
                          <span className="text-purple-400 text-xs font-semibold">Spaces & Review</span>
                          <p className="text-[11px] text-slate-400 mt-1">Review drafts before saving into authorized project spaces.</p>
                        </div>
                      </div>

                      <div className="p-4 rounded-lg bg-black/40 border border-white/[0.06] font-mono text-xs text-slate-300 space-y-2">
                        <p className="text-slate-400">// Clone and launch</p>
                        <p className="text-emerald-400">git clone https://github.com/CopilotKit/OpenDots.git</p>
                        <p className="text-slate-400">// Install dependencies and run locally</p>
                        <p className="text-emerald-400">npm install &amp;&amp; npm run dev</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-indigo-400">
                        <Globe className="w-5 h-5" />
                        <h2 className="text-lg font-bold text-white">{currentState.pageTitle}</h2>
                      </div>
                      <p className="text-xs text-slate-300">
                        Inspecting URL: <span className="text-indigo-400 font-mono">{currentState.url}</span>
                      </p>
                      <div className="p-4 rounded-lg bg-black/40 border border-white/[0.08] text-xs text-slate-400">
                        DOM stream rendered. Agent has parsed text blocks, links, and styling elements into workspace memory.
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
          <div className="flex-1 flex flex-col overflow-hidden bg-black font-mono text-xs text-slate-200">
            {/* Terminal Header */}
            <div className="px-4 py-2 bg-[#0c1017] border-b border-white/[0.08] flex items-center justify-between text-slate-400 text-[11px]">
              <div className="flex items-center gap-2">
                <TerminalIcon className="w-3.5 h-3.5 text-amber-400" />
                <span>nook@{currentAgent.id}:/workspace</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleClearTerminal}
                  className="text-slate-400 hover:text-white text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] transition-colors"
                >
                  Clear Console
                </button>
                <span className="text-emerald-400">STATUS: READY (BASH 5.2)</span>
              </div>
            </div>

            {/* Quick Command Chips */}
            <div className="px-4 py-1.5 bg-[#090d15] border-b border-white/[0.04] flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[11px]">
              <span className="text-slate-500 text-[10px] mr-1">Quick:</span>
              {['ls -la', 'npm test', 'git status', 'pwd', 'whoami', 'date'].map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => handleQuickCommand(cmd)}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-amber-300 hover:text-amber-200 border border-white/[0.06] text-[10px] transition-colors"
                >
                  ${cmd}
                </button>
              ))}
            </div>

            {/* Terminal Output Logs */}
            <div className="flex-1 p-4 overflow-y-auto space-y-2 scrollbar-thin">
              {currentState.terminalLogs.map((log) => (
                <div key={log.id} className="leading-relaxed">
                  {log.type === 'system' && (
                    <p className="text-slate-500">[SYSTEM] {log.text}</p>
                  )}
                  {log.type === 'input' && (
                    <div className="flex items-center gap-2 text-amber-300">
                      <span className="text-emerald-400 font-bold">$</span>
                      <span>{log.text}</span>
                    </div>
                  )}
                  {log.type === 'output' && (
                    <pre className="text-slate-300 whitespace-pre-wrap pl-4 border-l border-white/[0.1]">{log.text}</pre>
                  )}
                  {log.type === 'error' && (
                    <pre className="text-rose-400 whitespace-pre-wrap pl-4 border-l border-rose-500/30">{log.text}</pre>
                  )}
                </div>
              ))}
            </div>

            {/* Terminal Interactive Input */}
            <form onSubmit={handleTerminalSubmit} className="p-3 bg-[#0d121c] border-t border-white/[0.08] flex items-center gap-2">
              <span className="text-emerald-400 font-bold">$</span>
              <input
                type="text"
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                placeholder="Type command (e.g. ls -la, npm test, cat /workspace/scout_findings.md)..."
                className="bg-transparent border-none outline-none text-amber-300 placeholder:text-slate-600 flex-1 font-mono text-xs"
              />
              <button type="submit" className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-black font-semibold rounded text-xs transition-colors">
                Run
              </button>
            </form>
          </div>
        )}

        {/* ================= FILES VIEW ================= */}
        {activeTab === 'files' && (
          <div className="flex-1 flex overflow-hidden bg-[#070b11]">
            {/* File List */}
            <div className="w-72 border-r border-white/[0.08] bg-[#0c1017] p-3 flex flex-col shrink-0">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Files (/workspace)
                </span>
                <button
                  onClick={() => setIsCreatingFile(!isCreatingFile)}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  title="Create New File"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {isCreatingFile && (
                <form onSubmit={handleCreateVirtualFile} className="mb-2 p-2 rounded-lg bg-black/40 border border-white/[0.1] space-y-2">
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="filename.md"
                    className="w-full px-2 py-1 rounded bg-black/60 border border-white/[0.1] text-xs text-slate-100 outline-none font-mono"
                    autoFocus
                  />
                  <div className="flex items-center gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsCreatingFile(false)}
                      className="px-2 py-0.5 rounded text-[10px] text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium"
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
                        ? 'bg-indigo-600/20 text-white font-medium border border-indigo-500/30'
                        : 'hover:bg-white/[0.04] text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCode className={`w-3.5 h-3.5 ${getFileIconColor(file.name)} shrink-0`} />
                      <span className="truncate">{file.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{file.size}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* File Content Preview & Live Editor */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0e16]">
              {selectedFile ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/[0.08] bg-[#0d121c] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <FileCode className="w-4 h-4 text-indigo-400" />
                      <span className="font-mono text-white">{selectedFile.path}</span>
                      <span className="text-slate-500 text-[10px]">({selectedFile.size})</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveFileContent}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs text-white transition-colors font-medium shadow-sm"
                      >
                        {fileSaveSuccess ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Save className="w-3.5 h-3.5" />}
                        <span>{fileSaveSuccess ? 'Saved' : 'Save'}</span>
                      </button>

                      <button
                        onClick={() => copyFileContent(editedFileContent)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300 hover:text-white transition-colors"
                      >
                        {copiedFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedFile ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        onClick={() => {
                          if (confirm(`Delete file "${selectedFile.name}"?`)) {
                            handleDeleteVirtualFile(selectedFile.path);
                          }
                        }}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Delete File"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-slate-300 flex flex-col">
                    <textarea
                      value={editedFileContent}
                      onChange={(e) => setEditedFileContent(e.target.value)}
                      className="w-full flex-1 bg-transparent border-none outline-none resize-none font-mono text-xs leading-relaxed text-slate-200"
                      placeholder="File content..."
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                  Select a file from the workspace tree to view or edit contents.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= ACTIVITY VIEW ================= */}
        {activeTab === 'activity' && (
          <div className="flex-1 p-6 overflow-y-auto bg-[#070b11]">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <h3 className="text-sm font-semibold text-white">Agent Computer Activity Stream</h3>
                <span className="text-xs text-slate-400">Total Events: {currentState.activityLogs.length}</span>
              </div>

              <div className="space-y-3">
                {currentState.activityLogs.map((act) => (
                  <div key={act.id} className="p-3 rounded-lg bg-black/40 border border-white/[0.06] flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px] font-semibold">
                          {act.action}
                        </span>
                        <span className="text-xs text-slate-200 font-medium">{act.details}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono shrink-0 ml-4">{act.timestamp}</span>
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
