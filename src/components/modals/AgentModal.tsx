'use client';

import React, { useState } from 'react';
import { Agent, AgentRole, MCPTool, Space } from '@/types';
import { Bot, Monitor, Check, X } from 'lucide-react';

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAgent: (agent: Agent) => void;
  availableTools: MCPTool[];
  availableSpaces: Space[];
}

export const AgentModal: React.FC<AgentModalProps> = ({
  isOpen,
  onClose,
  onSaveAgent,
  availableTools,
  availableSpaces,
}) => {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('compass');
  const [role, setRole] = useState<AgentRole>('Custom Specialist');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [computerEnabled, setComputerEnabled] = useState(true);
  const [selectedTools, setSelectedTools] = useState<string[]>(['tool-web-search', 'tool-save-page']);
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>(availableSpaces.map((s) => s.id));

  const archetypeIcons = [
    { key: 'compass', label: 'Research' },
    { key: 'pen-tool', label: 'Writing' },
    { key: 'cpu', label: 'DevOps' },
    { key: 'sparkles', label: 'Strategy' },
    { key: 'bot', label: 'Custom' },
  ];

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newAgent: Agent = {
      id: `agent-${Date.now()}`,
      name: name.trim(),
      avatar: avatar.trim() || 'compass',
      role,
      description: description.trim() || `Specialized AI coworker in ${role}.`,
      systemPrompt: systemPrompt.trim() || `You are ${name}, a persistent specialist AI coworker at Nook. Your role is ${role}.`,
      status: 'idle',
      statusMessage: 'Ready for collaboration',
      color: '#ffffff',
      allowedTools: selectedTools,
      assignedSpaces: selectedSpaces,
      computerEnabled,
      createdAt: new Date().toISOString(),
    };

    onSaveAgent(newAgent);
    onClose();
  };

  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-xl rounded-2xl glass-card apple-fluid-glow p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto scrollbar-thin text-neutral-200 font-sans animate-scale-in">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/[0.08] text-white border border-white/[0.1] flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-tight">Create AI Coworker</h3>
              <p className="text-xs text-neutral-400">Configure persona, sandbox computer, and tool permissions</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-lg hover:bg-white/[0.08] text-neutral-400 hover:text-white transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-neutral-300 mb-1.5 font-medium">Archetype Vector Emblem</label>
            <div className="flex items-center gap-2">
              {archetypeIcons.map((ic) => (
                <button
                  key={ic.key}
                  type="button"
                  onClick={() => setAvatar(ic.key)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-mono transition-all flex items-center gap-1.5 ${
                    avatar === ic.key
                      ? 'bg-white text-black font-semibold border-white shadow-sm'
                      : 'bg-white/[0.04] text-neutral-400 border-white/[0.08] hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <span>{ic.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-neutral-300 mb-1 font-medium">Coworker Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Helix, Sentinel, Nova"
              required
              className="w-full px-3 py-2 rounded-xl bg-[#09090c] border border-white/[0.1] text-white outline-none focus:border-white/40"
            />
          </div>

          <div>
            <label className="block text-neutral-300 mb-1 font-medium">Specialist Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AgentRole)}
              className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none"
            >
              <option value="Research & Intelligence">Research & Intelligence (Web investigator)</option>
              <option value="Technical Writer">Technical Writer (Document architect)</option>
              <option value="DevOps & Engineer">DevOps & Engineer (Terminal & code operator)</option>
              <option value="Executive Strategist">Executive Strategist (High-level coordination)</option>
              <option value="Custom Specialist">Custom Specialist</option>
            </select>
          </div>

          <div>
            <label className="block text-neutral-300 mb-1 font-medium">Bio / Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Investigates technical protocols, runs tests, and drafts PRDs."
              className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40"
            />
          </div>

          <div>
            <label className="block text-neutral-300 mb-1 font-medium">System Instructions / Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              placeholder="Define behavioral principles, tone, and decision rules..."
              className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none resize-none"
            />
          </div>

          {/* Computer Sandbox Toggle */}
          <div className="p-3 rounded-xl bg-[#0d0d0d] border border-white/[0.08] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-white" />
              <div>
                <p className="font-semibold text-white">Enable Dedicated Computer</p>
                <p className="text-[11px] text-neutral-400">Allocates an isolated browser session, terminal shell, and file storage.</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={computerEnabled}
              onChange={(e) => setComputerEnabled(e.target.checked)}
              className="w-4 h-4 accent-white rounded cursor-pointer"
            />
          </div>

          {/* Permitted Tools Matrix */}
          <div>
            <label className="block text-neutral-300 mb-1.5 font-medium">Permitted Tools</label>
            <div className="grid grid-cols-2 gap-2">
              {availableTools.map((tool) => (
                <button
                  type="button"
                  key={tool.id}
                  onClick={() => toggleTool(tool.id)}
                  className={`p-2 rounded-lg border text-left flex items-center justify-between transition-colors ${
                    selectedTools.includes(tool.id)
                      ? 'bg-white/[0.1] border-white/20 text-white font-medium'
                      : 'bg-[#18181b] border-white/[0.04] text-neutral-400 hover:text-white'
                  }`}
                >
                  <span className="font-mono text-[11px]">{tool.name}</span>
                  {selectedTools.includes(tool.id) && <Check className="w-3.5 h-3.5 text-white" />}
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
              Create Coworker
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
