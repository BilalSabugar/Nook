'use client';

import React, { useState } from 'react';
import { Agent, AgentRole, MCPTool, Space } from '@/types';
import { Bot, Sparkles, Monitor, Shield, Check } from 'lucide-react';

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
  const [avatar, setAvatar] = useState('🤖');
  const [role, setRole] = useState<AgentRole>('Custom Specialist');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [computerEnabled, setComputerEnabled] = useState(true);
  const [selectedTools, setSelectedTools] = useState<string[]>(['tool-web-search', 'tool-save-page']);
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>(availableSpaces.map((s) => s.id));

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newAgent: Agent = {
      id: `agent-${Date.now()}`,
      name: name.trim(),
      avatar: avatar.trim() || '🤖',
      role,
      description: description.trim() || `Specialized AI coworker in ${role}.`,
      systemPrompt: systemPrompt.trim() || `You are ${name}, a persistent specialist AI coworker at Nook. Your role is ${role}.`,
      status: 'idle',
      statusMessage: 'Ready for collaboration',
      color: '#6366f1',
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

  const toggleSpace = (spaceId: string) => {
    setSelectedSpaces((prev) =>
      prev.includes(spaceId) ? prev.filter((id) => id !== spaceId) : [...prev, spaceId]
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-[#0e1420] border border-white/[0.12] p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto scrollbar-thin text-slate-200">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Create Persistent AI Coworker</h3>
              <p className="text-xs text-slate-400">Configure persona, sandbox computer, and tool permissions</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-1">
              <label className="block text-slate-300 mb-1 font-medium">Avatar Icon</label>
              <input
                type="text"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="🧭"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-center text-lg outline-none focus:border-indigo-500"
              />
            </div>

            <div className="col-span-3">
              <label className="block text-slate-300 mb-1 font-medium">Coworker Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Helix, Sentinel, Nova"
                required
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 mb-1 font-medium">Specialist Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AgentRole)}
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none"
            >
              <option value="Research & Intelligence">Research & Intelligence (Web investigator)</option>
              <option value="Technical Writer">Technical Writer (Document architect)</option>
              <option value="DevOps & Engineer">DevOps & Engineer (Terminal & code operator)</option>
              <option value="Executive Strategist">Executive Strategist (High-level coordination)</option>
              <option value="Custom Specialist">Custom Specialist</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 mb-1 font-medium">Bio / Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Investigates technical protocols, runs tests, and drafts PRDs."
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 mb-1 font-medium">System Instructions / Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              placeholder="Define behavioral principles, tone, and decision rules..."
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none resize-none"
            />
          </div>

          {/* Computer Sandbox Toggle */}
          <div className="p-3 rounded-xl bg-black/30 border border-white/[0.08] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="font-semibold text-white">Enable Dedicated Computer</p>
                <p className="text-[11px] text-slate-400">Allocates an isolated browser session, terminal shell, and file storage.</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={computerEnabled}
              onChange={(e) => setComputerEnabled(e.target.checked)}
              className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
            />
          </div>

          {/* Permitted Tools Matrix */}
          <div>
            <label className="block text-slate-300 mb-1.5 font-medium">Permitted Tools</label>
            <div className="grid grid-cols-2 gap-2">
              {availableTools.map((tool) => (
                <button
                  type="button"
                  key={tool.id}
                  onClick={() => toggleTool(tool.id)}
                  className={`p-2 rounded-lg border text-left flex items-center justify-between transition-colors ${
                    selectedTools.includes(tool.id)
                      ? 'bg-indigo-600/20 border-indigo-500/40 text-white'
                      : 'bg-black/30 border-white/[0.06] text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <span className="font-mono text-[11px]">{tool.name}</span>
                  {selectedTools.includes(tool.id) && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors shadow-lg shadow-emerald-900/30"
            >
              Create Coworker
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
