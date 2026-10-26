'use client';

import React, { useState } from 'react';
import { Space, DocumentPage, Agent } from '@/types';
import { 
  FileText, 
  Plus, 
  Grid, 
  List, 
  Search, 
  Sparkles, 
  Clock, 
  Tag, 
  ArrowLeft, 
  Save, 
  Check, 
  Eye, 
  Code, 
  Heading1, 
  Heading2, 
  ListOrdered, 
  CheckSquare, 
  MessageSquare,
  Bot,
  ExternalLink,
  Download,
  Copy,
  Trash2,
  SlidersHorizontal
} from 'lucide-react';
import { MarkdownViewer } from '@/components/spaces/MarkdownViewer';
import { SlashCommandPalette } from '@/components/spaces/SlashCommandPalette';
import { useToast } from '@/components/ui/Toast';



interface SpaceWorkspaceProps {
  space: Space;
  agents: Agent[];
  activePageId: string | null;
  onSelectPage: (pageId: string | null) => void;
  onCreatePage: (spaceId: string) => void;
  onUpdatePage: (spaceId: string, pageId: string, updates: Partial<DocumentPage>) => void;
  onAskAgentAboutPage: (agentId: string, page: DocumentPage) => void;
  onDeletePage?: (spaceId: string, pageId: string) => void;
}

export const SpaceWorkspace: React.FC<SpaceWorkspaceProps> = ({
  space,
  agents,
  activePageId,
  onSelectPage,
  onCreatePage,
  onUpdatePage,
  onAskAgentAboutPage,
  onDeletePage,
}) => {
  const toast = useToast();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [editorMode, setEditorMode] = useState<'visual' | 'preview' | 'markdown'>('visual');
  const [isSlashPaletteOpen, setIsSlashPaletteOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showPageChatDrawer, setShowPageChatDrawer] = useState(false);
  const [pageChatPrompt, setPageChatPrompt] = useState('');

  const activePage = space.pages.find((p) => p.id === activePageId) || null;

  const filteredPages = space.pages.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.excerpt && p.excerpt.toLowerCase().includes(searchQuery.toLowerCase())) ||
    p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const assignedAgents = agents.filter((a) => space.assignedAgentIds.includes(a.id));

  const handleContentChange = (newContent: string) => {
    if (!activePage) return;
    setIsSaving(true);
    onUpdatePage(space.id, activePage.id, {
      content: newContent,
      updatedAt: new Date().toISOString(),
      version: activePage.version + 1,
    });
    setTimeout(() => setIsSaving(false), 500);
  };

  const handleTitleChange = (newTitle: string) => {
    if (!activePage) return;
    onUpdatePage(space.id, activePage.id, {
      title: newTitle,
      updatedAt: new Date().toISOString(),
    });
  };

  const insertMarkdownSnippet = (snippet: string) => {
    if (!activePage) return;
    handleContentChange(activePage.content + '\n' + snippet);
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#070b12] text-slate-200 overflow-hidden">
      {/* Top Header Bar */}
      <div className="h-16 px-6 border-b border-white/[0.08] bg-[#0c1017] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {activePage && (
            <button
              onClick={() => onSelectPage(null)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors mr-1"
              title="Back to Space Library"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          <span className="text-2xl">{space.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white text-base tracking-tight">{space.name}</h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                {space.pages.length} Pages
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{space.description}</p>
          </div>
        </div>

        {/* Assigned Coworkers & Actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white/[0.04] px-2.5 py-1 rounded-lg border border-white/[0.08]">
            <span className="text-[11px] text-slate-400">Collaborators:</span>
            <div className="flex -space-x-1.5">
              {assignedAgents.map((agent) => (
                <span
                  key={agent.id}
                  title={`${agent.name} (${agent.role})`}
                  className="w-5 h-5 rounded-full bg-[#141d2e] border border-white/[0.1] flex items-center justify-center text-xs cursor-pointer hover:scale-110 transition-transform"
                >
                  {agent.avatar}
                </span>
              ))}
            </div>
          </div>

          <button
            onClick={() => onCreatePage(space.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all hover:scale-[1.02]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Page</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Canvas */}
      {activePage ? (
        /* ================= PAGE VISUAL EDITOR ================= */
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Document Toolbar */}
            <div className="px-6 py-2 bg-[#0c1017] border-b border-white/[0.08] flex items-center justify-between text-xs">
              {/* Formatting Helpers & Slash Palette Trigger */}
              <div className="flex items-center gap-1 relative">
                <button
                  onClick={() => setIsSlashPaletteOpen(!isSlashPaletteOpen)}
                  title="Slash Commands Menu (/)"
                  className={`px-2 py-1 rounded flex items-center gap-1 font-mono text-xs border transition-colors ${
                    isSlashPaletteOpen
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                      : 'bg-white/[0.05] hover:bg-white/[0.1] text-indigo-400 border-white/[0.08]'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>/ Blocks</span>
                </button>

                <SlashCommandPalette
                  isOpen={isSlashPaletteOpen}
                  onClose={() => setIsSlashPaletteOpen(false)}
                  onSelectCommand={insertMarkdownSnippet}
                  onTriggerAgent={() => setShowPageChatDrawer(true)}
                />

                <div className="h-4 w-[1px] bg-white/[0.1] mx-1" />

                <button
                  onClick={() => insertMarkdownSnippet('## Heading 2')}
                  title="Insert Heading"
                  className="p-1.5 rounded hover:bg-white/[0.06] text-slate-400 hover:text-white"
                >
                  <Heading2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertMarkdownSnippet('- [ ] Todo item')}
                  title="Insert Task Checkbox"
                  className="p-1.5 rounded hover:bg-white/[0.06] text-slate-400 hover:text-white"
                >
                  <CheckSquare className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertMarkdownSnippet('```typescript\n// your code here\n```')}
                  title="Insert Code Block"
                  className="p-1.5 rounded hover:bg-white/[0.06] text-slate-400 hover:text-white"
                >
                  <Code className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertMarkdownSnippet('> Callout note')}
                  title="Insert Quote"
                  className="p-1.5 rounded hover:bg-white/[0.06] text-slate-400 hover:text-white"
                >
                  <ListOrdered className="w-4 h-4" />
                </button>
              </div>

              {/* Autosave Status & Mode Toggle & Export Controls */}
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="font-mono">{activePage.content.trim().split(/\s+/).filter(Boolean).length} words</span>
                  <span className="text-slate-600">•</span>
                  {isSaving ? (
                    <span className="text-amber-400 flex items-center gap-1">
                      <Save className="w-3 h-3 animate-spin" /> Saving...
                    </span>
                  ) : (
                    <span className="text-emerald-400 flex items-center gap-1 font-mono">
                      <Check className="w-3 h-3" /> v{activePage.version} saved
                    </span>
                  )}
                </div>

                <div className="flex items-center bg-black/40 p-0.5 rounded-lg border border-white/[0.08]">
                  <button
                    onClick={() => setEditorMode('visual')}
                    className={`px-2 py-0.5 rounded text-[11px] ${
                      editorMode === 'visual'
                        ? 'bg-white/[0.12] text-white font-medium'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Editor
                  </button>
                  <button
                    onClick={() => setEditorMode('preview')}
                    className={`px-2 py-0.5 rounded text-[11px] flex items-center gap-1 ${
                      editorMode === 'preview'
                        ? 'bg-white/[0.12] text-white font-medium'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Eye className="w-3 h-3 text-indigo-400" />
                    <span>Preview</span>
                  </button>
                  <button
                    onClick={() => setEditorMode('markdown')}
                    className={`px-2 py-0.5 rounded text-[11px] ${
                      editorMode === 'markdown'
                        ? 'bg-white/[0.12] text-white font-medium'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Raw MD
                  </button>
                </div>

                {/* Export & Copy Helpers */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(activePage.content);
                    toast.success('Markdown copied to clipboard', 'Raw document ready to paste into any editor.');
                  }}
                  title="Copy Raw Markdown"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => {
                    const blob = new Blob([activePage.content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${activePage.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.info('Document Downloaded', `Saved as ${activePage.title}.md`);
                  }}
                  title="Download Markdown File"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>

                {onDeletePage && (
                  <button
                    onClick={() => {
                      if (confirm(`Are you sure you want to delete "${activePage.title}"?`)) {
                        onDeletePage(space.id, activePage.id);
                        toast.warning('Document Deleted', `"${activePage.title}" was removed from ${space.name}.`);
                        onSelectPage(null);
                      }
                    }}
                    title="Delete Document"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  onClick={() => setShowPageChatDrawer(!showPageChatDrawer)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    showPageChatDrawer
                      ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30'
                      : 'bg-white/[0.05] text-slate-300 hover:text-white border-white/[0.08]'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Ask Coworker</span>
                </button>
              </div>
            </div>

            {/* Document Content Canvas */}
            <div className="flex-1 p-8 overflow-y-auto max-w-4xl mx-auto w-full space-y-4">
              {/* Document Title Input */}
              <input
                type="text"
                value={activePage.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-2xl sm:text-3xl font-bold text-white placeholder:text-slate-600 tracking-tight"
                placeholder="Untitled Document..."
              />

              {/* Tags & Metadata */}
              <div className="flex items-center gap-2 pb-4 border-b border-white/[0.08] text-xs text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>Updated {new Date(activePage.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-slate-600">•</span>
                <div className="flex items-center gap-1">
                  {activePage.tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-white/[0.05] text-slate-300 text-[10px]">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Visual, Preview, or Raw Markdown Mode */}
              {editorMode === 'preview' ? (
                <div className="p-6 rounded-2xl bg-black/40 border border-white/[0.08] min-h-[500px] shadow-inner">
                  <MarkdownViewer content={activePage.content} />
                </div>
              ) : editorMode === 'visual' ? (
                <textarea
                  value={activePage.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  className="w-full min-h-[500px] bg-transparent border-none outline-none resize-none font-sans text-sm sm:text-base leading-relaxed text-slate-200 placeholder:text-slate-600"
                  placeholder="Type notes or markdown here... Tip: Click [/ Blocks] above to insert headings, checklists, and code."
                />
              ) : (
                <textarea
                  value={activePage.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  className="w-full min-h-[500px] bg-black/40 p-4 rounded-xl border border-white/[0.08] font-mono text-xs sm:text-sm text-slate-300 resize-none outline-none"
                />
              )}
            </div>
          </div>

          {/* Collaborative Page Chat Drawer */}
          {showPageChatDrawer && (
            <div className="w-80 border-l border-white/[0.08] bg-[#0b1018] flex flex-col h-full shrink-0">
              <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-white">Revise with Coworker</span>
                </div>
                <button
                  onClick={() => setShowPageChatDrawer(false)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              <div className="p-3 flex-1 overflow-y-auto space-y-3 text-xs text-slate-300">
                <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-indigo-200">
                  <p className="font-medium text-white mb-1">Page Assistant Context</p>
                  <p className="text-[11px] text-slate-400">
                    Your assigned specialists can inspect this document, append sections, refine formatting, or verify technical assertions.
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400">Choose Specialist:</span>
                  {assignedAgents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => onAskAgentAboutPage(agent.id, activePage)}
                      className="w-full text-left p-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] flex items-center justify-between group transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span>{agent.avatar}</span>
                        <div>
                          <p className="font-medium text-white text-xs">{agent.name}</p>
                          <p className="text-[10px] text-slate-400">{agent.role}</p>
                        </div>
                      </div>
                      <Sparkles className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 border-t border-white/[0.08] bg-black/20">
                <input
                  type="text"
                  value={pageChatPrompt}
                  onChange={(e) => setPageChatPrompt(e.target.value)}
                  placeholder="Ask agent to add section or edit..."
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-xs text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ================= SPACE DOCUMENT LIBRARY ================= */
        <div className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto w-full space-y-6">
          {/* Search & View Controls */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 max-w-md flex items-center gap-2 px-3.5 py-2 rounded-xl bg-black/40 border border-white/[0.08] text-xs">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search documents by title, tags, or content..."
                className="bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-500 w-full"
              />
            </div>

            <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/[0.08]">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg text-xs ${
                  viewMode === 'grid' ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg text-xs ${
                  viewMode === 'list' ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Grid View */}
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPages.map((page) => (
                <div
                  key={page.id}
                  onClick={() => onSelectPage(page.id)}
                  className="group p-5 rounded-2xl bg-[#0f1521] hover:bg-[#131b2a] border border-white/[0.08] hover:border-indigo-500/40 shadow-lg cursor-pointer transition-all duration-200 flex flex-col justify-between hover:-translate-y-0.5"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{page.icon || '📄'}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05] text-slate-400">
                        v{page.version}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-semibold text-white text-sm group-hover:text-indigo-300 transition-colors line-clamp-1">
                        {page.title}
                      </h3>
                      <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                        {page.excerpt || page.content.slice(0, 100)}...
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 mt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center gap-1">
                      {page.tags.slice(0, 2).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-300 text-[10px]">
                          #{t}
                        </span>
                      ))}
                    </div>
                    <span>{new Date(page.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* List View */
            <div className="rounded-xl border border-white/[0.08] bg-[#0f1521] overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#141b2b] border-b border-white/[0.08] text-slate-400 font-medium">
                  <tr>
                    <th className="py-3 px-4">Title</th>
                    <th className="py-3 px-4">Tags</th>
                    <th className="py-3 px-4">Version</th>
                    <th className="py-3 px-4">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {filteredPages.map((page) => (
                    <tr
                      key={page.id}
                      onClick={() => onSelectPage(page.id)}
                      className="hover:bg-white/[0.04] cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-white flex items-center gap-2.5">
                        <span className="text-base">{page.icon || '📄'}</span>
                        <span>{page.title}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {page.tags.join(', ')}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">v{page.version}</td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(page.updatedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
