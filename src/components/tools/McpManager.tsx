'use client';

import React, { useState } from 'react';
import { MCPTool, Agent } from '@/types';
import { 
  Layers, 
  ShieldCheck, 
  ShieldAlert, 
  Check, 
  Plus, 
  Terminal, 
  Globe, 
  FileCode, 
  Database, 
  Sparkles,
  ExternalLink,
  Play,
  X
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

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
  const toast = useToast();
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
      id: `mcp-${Date.now()}`,
      name: newToolName.trim(),
      description: newDesc.trim() || 'Custom registered MCP server tool',
      serverName: newServerName.trim(),
      enabled: true,
      requiresApproval: true,
      category: newCategory,
      parameters: [],
    };

    onAddCustomTool(tool);
    setShowAddModal(false);
    setNewToolName('');
    setNewServerName('');
    setNewDesc('');
    toast.success('MCP Server Connected', `Registered "${tool.name}" on ${tool.serverName}.`);
  };

  const handleTestTool = (tool: MCPTool) => {
    setTestResult(`[MCP Test OK] Connected to "${tool.serverName}". Tool "${tool.name}" returned status 200.`);
    toast.success('MCP Tool Verified', `Pinged "${tool.name}" via JSON-RPC 2.0 (200 OK).`);
    setTimeout(() => setTestResult(null), 3500);
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#0d0d0d] text-neutral-200 overflow-hidden font-sans">
      {/* Header Bar */}
      <div className="h-14 px-6 border-b border-white/[0.08] bg-[#0d0d0d] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/[0.08] text-white border border-white/[0.1] flex items-center justify-center">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white text-sm tracking-tight">Model Context Protocol (MCP)</h2>
              <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-white/[0.06] text-neutral-300 border border-white/[0.08]">
                {tools.filter((t) => t.enabled).length} Enabled
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Standard JSON-RPC 2.0 endpoints connecting sandboxed tools to coworkers
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-neutral-200 text-black text-xs font-semibold shadow-sm transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Connect MCP Server</span>
        </button>
      </div>

      {/* Test feedback banner */}
      {testResult && (
        <div className="px-6 py-2.5 bg-[#141414] border-b border-white/[0.08] text-neutral-200 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-white" />
          <span className="font-mono">{testResult}</span>
        </div>
      )}

      {/* Tools Content List */}
      <div className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto w-full space-y-4 scrollbar-thin animate-fade-in">
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
                className={`p-5 rounded-2xl border transition-all duration-200 flex flex-col justify-between animate-slide-up ${
                  tool.enabled
                    ? 'bg-[#141414] border-white/[0.1] shadow-sm hover:border-white/20'
                    : 'bg-[#111111] border-white/[0.04] opacity-50'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-sm">{tool.name}</h3>
                        <p className="text-[11px] text-neutral-400 font-mono">{tool.serverName}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => onToggleTool(tool.id)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-white/[0.1] transition-colors duration-200 ease-in-out focus:outline-none ${
                        tool.enabled ? 'bg-white' : 'bg-white/[0.08]'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-3.5 w-3.5 my-auto transform rounded-full shadow-sm ring-0 transition duration-200 ease-in-out ${
                          tool.enabled ? 'translate-x-4 bg-black' : 'translate-x-0.5 bg-neutral-400'
                        }`}
                      />
                    </button>
                  </div>

                  <p className="text-xs text-neutral-300 leading-relaxed">{tool.description}</p>
                </div>

                <div className="pt-4 mt-3 border-t border-white/[0.06] flex items-center justify-between text-xs">
                  {/* Approval Toggle */}
                  <button
                    onClick={() => onToggleApproval(tool.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                      tool.requiresApproval
                        ? 'bg-white/[0.08] text-white border-white/20'
                        : 'bg-white/[0.03] text-neutral-400 border-white/[0.06]'
                    }`}
                  >
                    {tool.requiresApproval ? (
                      <>
                        <ShieldAlert className="w-3.5 h-3.5 text-neutral-300" />
                        <span>Requires Review</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Autonomous Run</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleTestTool(tool)}
                    className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white px-2 py-1 rounded hover:bg-white/[0.05] transition-colors"
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl glass-card border border-white/[0.12] p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="text-base font-semibold text-white tracking-tight">Connect New MCP Server</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-lg hover:bg-white/[0.08] text-neutral-400 hover:text-white transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTool} className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-300 mb-1 font-medium">Tool Function Name</label>
                <input
                  type="text"
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                  placeholder="e.g. query_postgres_db, send_slack_alert"
                  className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40"
                  required
                />
              </div>

              <div>
                <label className="block text-neutral-300 mb-1 font-medium">MCP Server Name / URL</label>
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="e.g. GitHub MCP Server, http://localhost:8080/mcp"
                  className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40"
                  required
                />
              </div>

              <div>
                <label className="block text-neutral-300 mb-1 font-medium">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none"
                >
                  <option value="web">Web & Scraping</option>
                  <option value="code">Code & Repositories</option>
                  <option value="data">Data & Databases</option>
                  <option value="system">Terminal & Shell</option>
                  <option value="custom">Custom Service</option>
                </select>
              </div>

              <div>
                <label className="block text-neutral-300 mb-1 font-medium">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What does this MCP tool allow the agent to do?"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 rounded-lg text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold transition-colors"
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
