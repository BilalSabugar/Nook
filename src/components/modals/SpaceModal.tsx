'use client';

import React, { useState } from 'react';
import { Space, Agent } from '@/types';
import { FolderKanban, Check } from 'lucide-react';

interface SpaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSpace: (space: Space) => void;
  availableAgents: Agent[];
}

export const SpaceModal: React.FC<SpaceModalProps> = ({
  isOpen,
  onClose,
  onSaveSpace,
  availableAgents,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📁');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(availableAgents.map((a) => a.id));

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newSpace: Space = {
      id: `space-${Date.now()}`,
      name: name.trim(),
      description: description.trim() || 'Collaborative project space for documents and agent knowledge.',
      icon: icon.trim() || '📁',
      color: '#ffffff',
      pages: [],
      assignedAgentIds: selectedAgentIds,
      createdAt: new Date().toISOString(),
    };

    onSaveSpace(newSpace);
    onClose();
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#141414] border border-white/[0.1] p-6 shadow-2xl space-y-4 text-neutral-200 font-sans">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/[0.08] text-white border border-white/[0.1] flex items-center justify-center">
              <FolderKanban className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-tight">Create New Space</h3>
              <p className="text-xs text-neutral-400">Organize collaborative documents and knowledge</p>
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white p-1">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-1">
              <label className="block text-neutral-300 mb-1 font-medium">Icon</label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="📁"
                className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-center text-lg outline-none focus:border-white/40"
              />
            </div>

            <div className="col-span-3">
              <label className="block text-neutral-300 mb-1 font-medium">Space Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Architecture, Research Q4"
                required
                className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-neutral-300 mb-1 font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What will your team and coworkers build in this Space?"
              className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-neutral-300 mb-1.5 font-medium">Assign AI Coworkers</label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
              {availableAgents.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  className={`w-full p-2 rounded-lg border text-left flex items-center justify-between transition-colors ${
                    selectedAgentIds.includes(agent.id)
                      ? 'bg-white/[0.1] border-white/20 text-white font-medium'
                      : 'bg-[#18181b] border-white/[0.04] text-neutral-400 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{agent.avatar}</span>
                    <span className="text-xs text-neutral-200">{agent.name}</span>
                    <span className="text-[10px] text-neutral-500">({agent.role})</span>
                  </div>
                  {selectedAgentIds.includes(agent.id) && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold transition-colors shadow-sm"
            >
              Create Space
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
