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
  Search, 
  X,
  Layers,
  Circle
} from 'lucide-react';
import { AgentArchetypeIcon, SpaceArchetypeIcon } from '@/components/ui/ArchetypeIcon';

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

  return (
    <aside className="w-64 bg-[#0a0a0d] border-r border-white/[0.08] flex flex-col h-screen select-none shrink-0 text-neutral-300">
      {/* Brand Header — Minimalist OpenDots & ChatGPT aesthetic */}
      <div className="h-14 px-4 border-b border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Signature OpenDots monochrome emblem */}
          <div className="w-7 h-7 rounded-lg bg-white text-black flex items-center justify-center font-bold text-sm tracking-tight shadow-md">
            <span>●</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white tracking-tight text-sm">Nook</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-neutral-400 border border-white/[0.08]">
              v1.0
            </span>
          </div>
        </div>

        <button 
          onClick={onOpenSettingsModal}
          title="Settings & Models"
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Minimalist Search Bar */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#121216] border border-white/[0.08] focus-within:border-white/20 text-xs text-neutral-400 transition-colors">
          <Search className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search spaces & coworkers..." 
            className="bg-transparent border-none outline-none text-neutral-200 placeholder:text-neutral-500 w-full text-xs" 
          />
          {searchQuery ? (
            <button 
              onClick={() => setSearchQuery('')}
              className="text-neutral-500 hover:text-neutral-300 p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <kbd className="text-[9px] bg-white/[0.04] px-1 py-0.5 rounded text-neutral-500 font-mono border border-white/[0.06]">⌘K</kbd>
          )}
        </div>
      </div>

      {/* Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5 scrollbar-thin">
        {/* SPACES SECTION */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-medium tracking-wide text-neutral-500 flex items-center gap-1.5 uppercase font-mono">
              <FolderKanban className="w-3.5 h-3.5 text-neutral-400" />
              Spaces
            </span>
            <button
              onClick={onOpenNewSpaceModal}
              title="New Space"
              className="text-neutral-500 hover:text-neutral-200 p-0.5 rounded hover:bg-white/[0.06] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {filteredSpaces.map((space) => {
              const isSelected = activeView === 'space' && activeSpaceId === space.id;
              return (
                <button
                  key={space.id}
                  onClick={() => onSelectSpace(space.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-xl text-xs flex items-center justify-between group transition-all ${
                    isSelected
                      ? 'bg-white/[0.1] text-white font-medium border border-white/[0.12] shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <SpaceArchetypeIcon iconKey={space.icon} name={space.name} className={isSelected ? 'text-white' : 'text-neutral-400'} />
                    <span className="truncate">{space.name}</span>
                  </div>
                  <span className={`text-[10px] font-mono shrink-0 px-1.5 py-0.2 rounded-full ${
                    isSelected 
                      ? 'text-neutral-200 bg-white/[0.1]' 
                      : 'text-neutral-500 bg-white/[0.03]'
                  }`}>
                    {space.pages.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* COWORKERS SECTION */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-medium tracking-wide text-neutral-500 flex items-center gap-1.5 uppercase font-mono">
              <Bot className="w-3.5 h-3.5 text-neutral-400" />
              Coworkers
            </span>
            <button
              onClick={onOpenNewAgentModal}
              title="New Coworker"
              className="text-neutral-500 hover:text-neutral-200 p-0.5 rounded hover:bg-white/[0.06] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {filteredAgents.map((agent) => {
              const isSelected = activeView === 'agent' && activeAgentId === agent.id;
              const isThinking = agent.status === 'thinking' || agent.status === 'browsing';

              return (
                <button
                  key={agent.id}
                  onClick={() => onSelectAgent(agent.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-xl text-xs flex items-center justify-between group transition-all ${
                    isSelected
                      ? 'bg-white/[0.1] text-white font-medium border border-white/[0.12] shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0 flex items-center justify-center">
                      <AgentArchetypeIcon name={agent.name} avatarKey={agent.avatar} size="sm" />
                      {/* Signature OpenDots minimal presence indicator */}
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#0a0a0d] ${
                        isThinking 
                          ? 'bg-white animate-pulse' 
                          : 'bg-emerald-500'
                      }`} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium leading-none mb-1 text-neutral-200 group-hover:text-white">{agent.name}</p>
                      <p className="truncate text-[10px] text-neutral-400 leading-none">{agent.role}</p>
                    </div>
                  </div>

                  {agent.computerEnabled && (
                    <span 
                      title="Persistent Computer Sandbox"
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-white/[0.05] text-neutral-400 border border-white/[0.08] shrink-0"
                    >
                      PC
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ENVIRONMENTS */}
        <div>
          <div className="px-2 mb-1 text-[11px] font-medium tracking-wide text-neutral-500 flex items-center gap-1.5 uppercase">
            <Cpu className="w-3.5 h-3.5 text-neutral-400" />
            Environments
          </div>

          <div className="space-y-0.5">
            <button
              onClick={() => onSelectView('computer')}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors ${
                activeView === 'computer'
                  ? 'bg-white/[0.1] text-white font-medium border border-white/[0.12]'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs truncate">Agent Computers</p>
                <p className="text-[10px] text-neutral-500 truncate">Browser, Terminal & Files</p>
              </div>
            </button>

            <button
              onClick={() => onSelectView('tools')}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors ${
                activeView === 'tools'
                  ? 'bg-white/[0.1] text-white font-medium border border-white/[0.12]'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs truncate">MCP & Tools</p>
                <p className="text-[10px] text-neutral-500 truncate">Protocol & Permissions</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Minimal Footer */}
      <div className="p-3 border-t border-white/[0.08] bg-[#0a0a0a] text-xs">
        <div className="flex items-center justify-between text-[11px] text-neutral-500">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-neutral-400">Nook OS</span>
          </div>
          <span className="font-mono text-[10px] text-neutral-500">
            Online
          </span>
        </div>
      </div>
    </aside>
  );
};
