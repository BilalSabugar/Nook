'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Agent, Space } from '@/types';
import { 
  Search, 
  Bot, 
  FolderKanban, 
  Terminal, 
  Layers, 
  Settings2, 
  Plus, 
  Phone, 
  FileText, 
  ArrowRight,
  Sparkles,
  Command,
  Target
} from 'lucide-react';
import { AgentArchetypeIcon, SpaceArchetypeIcon } from '@/components/ui/ArchetypeIcon';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  agents: Agent[];
  spaces: Space[];
  onSelectAgent: (agentId: string) => void;
  onSelectSpace: (spaceId: string) => void;
  onSelectView: (view: 'space' | 'agent' | 'computer' | 'tools' | 'missions') => void;
  onOpenNewAgentModal: () => void;
  onOpenNewSpaceModal: () => void;
  onOpenSettingsModal: () => void;
  onStartVoiceCall?: () => void;
}

interface PaletteItem {
  id: string;
  category: 'Coworkers' | 'Spaces' | 'Environments' | 'Actions';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  agents,
  spaces,
  onSelectAgent,
  onSelectSpace,
  onSelectView,
  onOpenNewAgentModal,
  onOpenNewSpaceModal,
  onOpenSettingsModal,
  onStartVoiceCall,
}) => {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // Open handled by parent or toggled
        }
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Assemble searchable items
  const allItems: PaletteItem[] = [
    // Coworkers
    ...agents.map((a) => ({
      id: `agent-${a.id}`,
      category: 'Coworkers' as const,
      title: a.name,
      subtitle: a.role,
      icon: <AgentArchetypeIcon name={a.name} avatarKey={a.avatar} size="sm" />,
      action: () => {
        onSelectAgent(a.id);
        onSelectView('agent');
        onClose();
      },
    })),
    // Spaces
    ...spaces.map((s) => ({
      id: `space-${s.id}`,
      category: 'Spaces' as const,
      title: s.name,
      subtitle: `${s.pages.length} documents`,
      icon: <SpaceArchetypeIcon iconKey={s.icon} className="w-4 h-4 text-white" />,
      action: () => {
        onSelectSpace(s.id);
        onSelectView('space');
        onClose();
      },
    })),
    // Environments
    {
      id: 'env-missions',
      category: 'Environments' as const,
      title: 'Missions & Evidence Engine',
      subtitle: 'Multi-agent orchestration, goals & verification trail',
      icon: <Target className="w-4 h-4 text-purple-400" />,
      action: () => {
        onSelectView('missions');
        onClose();
      },
    },
    {
      id: 'env-computer',
      category: 'Environments' as const,
      title: 'Agent Computers & Sandboxes',
      subtitle: 'Virtual browser, terminal & file system',
      icon: <Terminal className="w-4 h-4 text-amber-400" />,
      action: () => {
        onSelectView('computer');
        onClose();
      },
    },
    {
      id: 'env-tools',
      category: 'Environments' as const,
      title: 'MCP Tools & Protocols',
      subtitle: 'Connected Model Context Protocol servers',
      icon: <Layers className="w-4 h-4 text-emerald-400" />,
      action: () => {
        onSelectView('tools');
        onClose();
      },
    },
    // Actions
    {
      id: 'act-voice',
      category: 'Actions' as const,
      title: 'Start Voice Session',
      subtitle: 'Real-time audio collaboration with active coworker',
      icon: <Phone className="w-4 h-4 text-purple-400" />,
      action: () => {
        onClose();
        if (onStartVoiceCall) onStartVoiceCall();
      },
    },
    {
      id: 'act-new-agent',
      category: 'Actions' as const,
      title: 'Create AI Coworker',
      subtitle: 'Configure persona, archetype and sandbox permissions',
      icon: <Plus className="w-4 h-4 text-white" />,
      action: () => {
        onClose();
        onOpenNewAgentModal();
      },
    },
    {
      id: 'act-new-space',
      category: 'Actions' as const,
      title: 'Create Space',
      subtitle: 'Organize team knowledge and shared documents',
      icon: <Plus className="w-4 h-4 text-white" />,
      action: () => {
        onClose();
        onOpenNewSpaceModal();
      },
    },
    {
      id: 'act-settings',
      category: 'Actions' as const,
      title: 'Intelligence & Provider Settings',
      subtitle: 'Manage Gemini, OpenAI, Claude, and local models',
      icon: <Settings2 className="w-4 h-4 text-neutral-400" />,
      action: () => {
        onClose();
        onOpenSettingsModal();
      },
    },
  ];

  const filteredItems = allItems.filter((item) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      item.title.toLowerCase().includes(q) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
      item.category.toLowerCase().includes(q)
    );
  });

  // Navigation handlers
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-2xl flex items-start justify-center pt-24 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-xl rounded-2xl glass-card border border-white/[0.14] shadow-2xl overflow-hidden text-neutral-200 animate-scale-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.08] bg-black/30">
          <Search className="w-4 h-4 text-neutral-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search coworkers, spaces, tools, or actions..."
            className="w-full bg-transparent border-none outline-none text-white placeholder:text-neutral-500 text-sm font-sans"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[10px] font-mono text-neutral-400 border border-white/[0.1]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[380px] overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-500 font-mono">
              No matching coworkers, spaces, or commands found.
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-all ${
                    isSelected
                      ? 'bg-white/[0.1] text-white border border-white/[0.12] shadow-sm'
                      : 'text-neutral-300 hover:text-white border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-white tracking-tight truncate text-xs">{item.title}</p>
                      {item.subtitle && (
                        <p className="text-[11px] text-neutral-400 truncate">{item.subtitle}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.04]">
                      {item.category}
                    </span>
                    {isSelected && (
                      <ArrowRight className="w-3.5 h-3.5 text-neutral-300 animate-fade-in" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Shortcut Hints */}
        <div className="px-4 py-2 border-t border-white/[0.06] bg-black/40 flex items-center justify-between text-[11px] text-neutral-400 font-mono">
          <div className="flex items-center gap-3">
            <span><kbd className="text-neutral-300">↑↓</kbd> navigate</span>
            <span><kbd className="text-neutral-300">↵</kbd> select</span>
          </div>
          <span className="flex items-center gap-1">
            <Command className="w-3 h-3 text-neutral-500" /> Nook Command Center
          </span>
        </div>
      </div>
    </div>
  );
};
