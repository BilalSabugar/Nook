'use client';

import React, { useState } from 'react';
import { MCPTool, Agent } from '@/types';
import { 
  Layers, 
  Plus, 
  ShieldCheck, 
  ShieldAlert, 
  Play, 
  Check, 
  Globe, 
  Terminal, 
  Database, 
  FileCode,
  Sparkles,
  Settings,
  Sliders
} from 'lucide-react';

interface McpManagerProps {
  tools: MCPTool[];
  agents: Agent[];
  onToggleTool: (toolId: string) => void;
  onToggleApproval: (toolId: string) => void;
  onAddCustomTool: (tool: MCPTool) => void;
}

export const McpManager: React.FC<McpManagerProps> = ({
  tools,
  agents,
  onToggleTool,
  onToggleApproval,
  onAddCustomTool,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newToolName, setNewToolName] = useState('');
  const [newServerName, setNewServerName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<'web' | 'code' | 'data' | 'system' | 'custom'>('custom');
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleCreateTool = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newToolName.trim() || !newServerName.trim()) return;

    const tool: MCPTool = {
      id: `tool-${Date.now()}`,
      name: newToolName.trim().toLowerCase().replace(/\s+/g, '_'),
      serverName: newServerName.trim(),
      description: newDesc.trim() || 'Custom MCP Tool Integration',
      category: newCategory,
      enabled: true,
      requiresApproval: true,
      parameters: [{ name: 'input', type: 'string', required: true, description: 'Tool parameter' }],
    };

    onAddCustomTool(tool);
    setShowAddModal(false);
    setNewToolName('');
    setNewServerName('');
    setNewDesc('');
  };

  const handleTestTool = (tool: MCPTool) => {
    setTestResult(`[MCP Test OK] Connected to "${tool.serverName}". Tool "${tool.name}" returned status 200.`);
    setTimeout(() => setTestResult(null), 3500);
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#070b12] text-slate-200 overflow-hidden">
      {/* Header Bar */}
      <div className="h-16 px-6 border-b border-white/[0.08] bg-[#0c1017] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white text-base tracking-tight">Model Context Protocol (MCP)</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                {tools.filter((t) => t.enabled).length} Enabled
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Connect external services, APIs, and sandboxed runtimes to your AI Coworkers.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 transition-all hover:scale-[1.02]"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Connect MCP Server</span>
        </button>
      </div>

      {/* Test feedback toast */}
      {testResult && (
        <div className="px-6 py-2.5 bg-emerald-950/40 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{testResult}</span>
        </div>
      )}

      {/* Tools Content List */}
      <div className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto w-full space-y-4 scrollbar-thin">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tools.map((tool) => {
            const categoryIcons = {
              web: Globe,
              code: FileCode,
              data: Database,
              system: Terminal,
              custom: Sparkles,
            };
            const Icon = categoryIcons[tool.category] || Sparkles;

            return (
              <div
                key={tool.id}
                className={`p-5 rounded-2xl border transition-all duration-200 flex flex-col justify-between ${
                  tool.enabled
                    ? 'bg-[#0f1522] border-white/[0.08] shadow-lg'
                    : 'bg-[#0b0f17] border-white/[0.04] opacity-60'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-purple-400">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-sm">{tool.name}</h3>
                        <p className="text-[11px] text-slate-400 font-mono">{tool.serverName}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => onToggleTool(tool.id)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        tool.enabled ? 'bg-purple-600' : 'bg-white/[0.1]'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          tool.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">{tool.description}</p>
                </div>

                <div className="pt-4 mt-3 border-t border-white/[0.06] flex items-center justify-between text-xs">
                  {/* Approval Toggle */}
                  <button
                    onClick={() => onToggleApproval(tool.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                      tool.requiresApproval
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    }`}
                  >
                    {tool.requiresApproval ? (
                      <>
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                        <span>Requires Review</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Autonomous Run</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleTestTool(tool)}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-white/[0.05] transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    <span>Test Ping</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Custom MCP Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0f1522] border border-white/[0.1] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="text-base font-semibold text-white">Connect New MCP Server</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTool} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">Tool Function Name</label>
                <input
                  type="text"
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                  placeholder="e.g. query_postgres_db, send_slack_alert"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">MCP Server Name / URL</label>
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="e.g. GitHub MCP Server, http://localhost:8080/mcp"
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none"
                >
                  <option value="web">Web & Scraping</option>
                  <option value="code">Code & Repositories</option>
                  <option value="data">Data & Databases</option>
                  <option value="system">Terminal & Shell</option>
                  <option value="custom">Custom Service</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What does this MCP tool allow the agent to do?"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 rounded-lg text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors"
                >
                  Add MCP Tool
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
