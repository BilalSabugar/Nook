'use client';

import React from 'react';
import { Agent, Space } from '@/types';
import { 
  FolderKanban, 
  Bot, 
  Terminal, 
  Cpu, 
  Plus, 
  Settings2, 
  Sparkles,
  Layers,
  Search,
  ExternalLink
} from 'lucide-react';

interface SidebarProps {
  spaces: Space[];
  agents: Agent[];
  activeSpaceId: string | null;
  activeAgentId: string | null;
  activeView: 'space' | 'agent' | 'computer' | 'tools';
  onSelectSpace: (spaceId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectView: (view: 'space' | 'agent' | 'computer' | 'tools') => void;
  onOpenNewAgentModal: () => void;
  onOpenNewSpaceModal: () => void;
  onOpenSettingsModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  spaces,
  agents,
  activeSpaceId,
  activeAgentId,
  activeView,
  onSelectSpace,
  onSelectAgent,
  onSelectView,
  onOpenNewAgentModal,
  onOpenNewSpaceModal,
  onOpenSettingsModal,
}) => {
  return (
    <aside className="w-72 bg-[#0c1017] border-r border-white/[0.08] flex flex-col h-screen select-none shrink-0 text-slate-300">
      {/* Brand Header */}
      <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-bold text-lg tracking-wider">
            N
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white tracking-tight text-base">Nook</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">v1.0</span>
            </div>
            <p className="text-[11px] text-slate-400">Autonomous AI Coworkers</p>
          </div>
        </div>

        <button 
          onClick={onOpenSettingsModal}
          title="Nook Settings & LLM Config"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Search & Status Banner */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-slate-400">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search spaces & docs..." 
            className="bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-500 w-full text-xs" 
          />
          <kbd className="text-[9px] bg-white/[0.05] px-1 py-0.5 rounded text-slate-500 font-mono">⌘K</kbd>
        </div>
      </div>

      {/* Nav Scroll Area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-6 scrollbar-thin">
        {/* SPACES SECTION */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <FolderKanban className="w-3.5 h-3.5 text-indigo-400" />
              Spaces
            </span>
            <button
              onClick={onOpenNewSpaceModal}
              title="Create new Space"
              className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-white/[0.06] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {spaces.map((space) => {
              const isSelected = activeView === 'space' && activeSpaceId === space.id;
              return (
                <button
                  key={space.id}
                  onClick={() => onSelectSpace(space.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between group transition-all duration-150 ${
                    isSelected
                      ? 'bg-indigo-600/20 text-white font-medium border border-indigo-500/30'
                      : 'hover:bg-white/[0.04] text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-sm shrink-0">{space.icon}</span>
                    <span className="truncate">{space.name}</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                    isSelected ? 'bg-indigo-500/30 text-indigo-200' : 'bg-white/[0.05] text-slate-400 group-hover:text-slate-300'
                  }`}>
                    {space.pages.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* PERSISTENT AI COWORKERS SECTION */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              AI Coworkers
            </span>
            <button
              onClick={onOpenNewAgentModal}
              title="Create new persistent Agent"
              className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-white/[0.06] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {agents.map((agent) => {
              const isSelected = activeView === 'agent' && activeAgentId === agent.id;
              
              // Status indicator color
              const statusColors: Record<string, string> = {
                idle: 'bg-emerald-400',
                thinking: 'bg-amber-400 animate-pulse',
                browsing: 'bg-blue-400 animate-pulse',
                executing: 'bg-indigo-400 animate-pulse',
                waiting_review: 'bg-pink-400 animate-ping',
              };

              return (
                <button
                  key={agent.id}
                  onClick={() => onSelectAgent(agent.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between group transition-all duration-150 ${
                    isSelected
                      ? 'bg-white/[0.08] text-white font-medium border border-white/[0.12] shadow-sm'
                      : 'hover:bg-white/[0.04] text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <span className="text-base">{agent.avatar}</span>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#0c1017] ${statusColors[agent.status] || 'bg-slate-400'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs leading-none mb-1 text-slate-200">{agent.name}</p>
                      <p className="truncate text-[10px] text-slate-400 leading-none">{agent.role}</p>
                    </div>
                  </div>

                  {agent.computerEnabled && (
                    <span 
                      title="Has dedicated computer sandbox"
                      className="text-[9px] font-mono px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0"
                    >
                      PC
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* WORKSPACE TOOLS & COMPUTERS */}
        <div>
          <div className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-amber-400" />
            Environments
          </div>

          <div className="space-y-0.5">
            <button
              onClick={() => onSelectView('computer')}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center gap-2.5 transition-all duration-150 ${
                activeView === 'computer'
                  ? 'bg-amber-500/20 text-white font-medium border border-amber-500/30'
                  : 'hover:bg-white/[0.04] text-slate-300'
              }`}
            >
              <Terminal className="w-4 h-4 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">Agent Computers</p>
                <p className="text-[10px] text-slate-400 truncate">Browser, Terminal & Files</p>
              </div>
            </button>

            <button
              onClick={() => onSelectView('tools')}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center gap-2.5 transition-all duration-150 ${
                activeView === 'tools'
                  ? 'bg-purple-500/20 text-white font-medium border border-purple-500/30'
                  : 'hover:bg-white/[0.04] text-slate-300'
              }`}
            >
              <Layers className="w-4 h-4 text-purple-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">MCP & Connections</p>
                <p className="text-[10px] text-slate-400 truncate">Tool permissions & servers</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Footer / System Health */}
      <div className="p-3 border-t border-white/[0.08] bg-black/20 text-xs">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Nook Runtime: Ready</span>
          </div>
          <span className="font-mono text-[10px] text-slate-500">v1.0.0</span>
        </div>
      </div>
    </aside>
  );
};
