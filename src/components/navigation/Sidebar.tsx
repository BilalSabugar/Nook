'use client';

import React, { useState } from 'react';
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
  ExternalLink,
  Shield,
  Activity,
  X
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
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSpaces = spaces.filter((s) => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAgents = agents.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Role tag styling map
  const getRoleBadge = (role: string) => {
    const lower = role.toLowerCase();
    if (lower.includes('research') || lower.includes('analyst')) {
      return { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' };
    }
    if (lower.includes('writer') || lower.includes('content') || lower.includes('docs')) {
      return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' };
    }
    if (lower.includes('engineer') || lower.includes('dev') || lower.includes('code')) {
      return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' };
    }
    return { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };
  };

  return (
    <aside className="w-72 bg-[#0a0e16]/95 backdrop-blur-xl border-r border-white/[0.08] flex flex-col h-screen select-none shrink-0 text-slate-300 relative z-20">
      {/* Brand Header */}
      <div className="p-4 border-b border-white/[0.08] flex items-center justify-between relative overflow-hidden">
        {/* Subtle glow in header corner */}
        <div className="absolute top-0 left-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center gap-3 relative z-10">
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-xl blur-xs opacity-70 group-hover:opacity-100 transition duration-300" />
            <div className="relative w-9 h-9 rounded-xl bg-[#0c1017] flex items-center justify-center text-white font-bold text-lg tracking-wider border border-white/[0.1]">
              <span className="bg-gradient-to-br from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent">N</span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white tracking-tight text-base">Nook</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">OS v1.0</span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Autonomous Coworkers</p>
          </div>
        </div>

        <button 
          onClick={onOpenSettingsModal}
          title="Nook Settings & LLM Config"
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] border border-transparent hover:border-white/[0.08] transition-all duration-150 active:scale-95"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Search Bar */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.07] focus-within:border-indigo-500/50 focus-within:bg-black/40 focus-within:ring-1 focus-within:ring-indigo-500/20 text-xs text-slate-400 transition-all">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search spaces & coworkers..." 
            className="bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-500 w-full text-xs" 
          />
          {searchQuery ? (
            <button 
              onClick={() => setSearchQuery('')}
              className="text-slate-500 hover:text-slate-300 p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <kbd className="text-[9px] bg-white/[0.06] px-1.5 py-0.5 rounded text-slate-400 font-mono border border-white/[0.06]">⌘K</kbd>
          )}
        </div>
      </div>

      {/* Nav Scroll Area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-6 scrollbar-thin">
        {/* SPACES SECTION */}
        <div>
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <FolderKanban className="w-3.5 h-3.5 text-indigo-400" />
              Living Spaces
            </span>
            <button
              onClick={onOpenNewSpaceModal}
              title="Create new Space"
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition-colors active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1">
            {filteredSpaces.map((space) => {
              const isSelected = activeView === 'space' && activeSpaceId === space.id;
              return (
                <button
                  key={space.id}
                  onClick={() => onSelectSpace(space.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs flex items-center justify-between group transition-all duration-150 relative ${
                    isSelected
                      ? 'bg-gradient-to-r from-indigo-600/25 to-purple-600/15 text-white font-medium border border-indigo-500/40 shadow-sm shadow-indigo-900/30'
                      : 'hover:bg-white/[0.04] text-slate-300 border border-transparent'
                  }`}
                >
                  {/* Left active accent bar */}
                  {isSelected && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-indigo-500" />
                  )}

                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base shrink-0 group-hover:scale-110 transition-transform">{space.icon}</span>
                    <span className="truncate">{space.name}</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono shrink-0 transition-colors ${
                    isSelected 
                      ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-500/30' 
                      : 'bg-white/[0.05] text-slate-400 group-hover:text-slate-200 border border-white/[0.04]'
                  }`}>
                    {space.pages.length} {space.pages.length === 1 ? 'doc' : 'docs'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* PERSISTENT AI COWORKERS SECTION */}
        <div>
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              AI Coworkers
            </span>
            <button
              onClick={onOpenNewAgentModal}
              title="Create new persistent Agent"
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition-colors active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1">
            {filteredAgents.map((agent) => {
              const isSelected = activeView === 'agent' && activeAgentId === agent.id;
              const roleBadge = getRoleBadge(agent.role);
              
              // Status indicator styling
              const statusColors: Record<string, { bg: string; ring: string }> = {
                idle: { bg: 'bg-emerald-400', ring: 'ring-emerald-400/30' },
                thinking: { bg: 'bg-amber-400 animate-pulse', ring: 'ring-amber-400/40' },
                browsing: { bg: 'bg-cyan-400 animate-pulse', ring: 'ring-cyan-400/40' },
                executing: { bg: 'bg-indigo-400 animate-pulse', ring: 'ring-indigo-400/40' },
                waiting_review: { bg: 'bg-pink-400 animate-ping', ring: 'ring-pink-400/50' },
              };

              const currentStatus = statusColors[agent.status] || { bg: 'bg-slate-400', ring: 'ring-slate-400/20' };

              return (
                <button
                  key={agent.id}
                  onClick={() => onSelectAgent(agent.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs flex items-center justify-between group transition-all duration-150 relative ${
                    isSelected
                      ? 'bg-white/[0.08] text-white font-medium border border-white/[0.14] shadow-md shadow-black/40'
                      : 'hover:bg-white/[0.04] text-slate-300 border border-transparent'
                  }`}
                >
                  {/* Left active accent bar */}
                  {isSelected && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-emerald-400" />
                  )}

                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <span className="text-lg group-hover:scale-105 transition-transform inline-block">{agent.avatar}</span>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a0e16] ${currentStatus.bg}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="truncate text-xs font-semibold leading-none text-slate-200">{agent.name}</p>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-medium border ${roleBadge.bg} ${roleBadge.text} ${roleBadge.border}`}>
                          {agent.role.split(' ')[0]}
                        </span>
                      </div>
                      <p className="truncate text-[10px] text-slate-400 leading-tight">
                        {agent.statusMessage || agent.role}
                      </p>
                    </div>
                  </div>

                  {agent.computerEnabled && (
                    <span 
                      title="Has dedicated persistent sandbox"
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 group-hover:border-emerald-500/40 transition-colors"
                    >
                      PC
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* WORKSPACE ENVIRONMENTS */}
        <div>
          <div className="px-2 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-amber-400" />
            Environments
          </div>

          <div className="space-y-1">
            <button
              onClick={() => onSelectView('computer')}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center gap-2.5 transition-all duration-150 ${
                activeView === 'computer'
                  ? 'bg-amber-500/20 text-white font-medium border border-amber-500/35 shadow-sm'
                  : 'hover:bg-white/[0.04] text-slate-300 border border-transparent'
              }`}
            >
              <div className="w-6 h-6 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 border border-amber-500/30">
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">Agent Computers</p>
                <p className="text-[10px] text-slate-400 truncate">Browser, Terminal & Files</p>
              </div>
            </button>

            <button
              onClick={() => onSelectView('tools')}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center gap-2.5 transition-all duration-150 ${
                activeView === 'tools'
                  ? 'bg-purple-500/20 text-white font-medium border border-purple-500/35 shadow-sm'
                  : 'hover:bg-white/[0.04] text-slate-300 border border-transparent'
              }`}
            >
              <div className="w-6 h-6 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0 border border-purple-500/30">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">MCP & Connections</p>
                <p className="text-[10px] text-slate-400 truncate">JSON-RPC & Sandbox permissions</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Footer / System Health Widget */}
      <div className="p-3 border-t border-white/[0.08] bg-[#070b12]/80 text-xs">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-slate-300 font-medium">Nook Runtime Active</span>
          </div>
          <span className="font-mono text-[10px] text-slate-500 bg-white/[0.05] px-1.5 py-0.5 rounded border border-white/[0.06]">
            Sandbox: OK
          </span>
        </div>
      </div>
    </aside>
  );
};
