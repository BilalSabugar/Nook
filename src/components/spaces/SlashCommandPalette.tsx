'use client';

import React from 'react';
import { 
  Heading1, 
  Heading2, 
  Heading3, 
  CheckSquare, 
  Code, 
  Quote, 
  Table, 
  Minus, 
  Bot, 
  Sparkles 
} from 'lucide-react';

interface SlashCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCommand: (snippet: string) => void;
  onTriggerAgent: () => void;
}

export const SlashCommandPalette: React.FC<SlashCommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectCommand,
  onTriggerAgent,
}) => {
  if (!isOpen) return null;

  const commands = [
    {
      title: 'Heading 1',
      desc: 'Large title header',
      icon: Heading1,
      snippet: '# Heading 1\n',
    },
    {
      title: 'Heading 2',
      desc: 'Medium section header',
      icon: Heading2,
      snippet: '## Heading 2\n',
    },
    {
      title: 'Heading 3',
      desc: 'Small subsection header',
      icon: Heading3,
      snippet: '### Heading 3\n',
    },
    {
      title: 'Task Checklist',
      desc: 'Track tasks with checkboxes',
      icon: CheckSquare,
      snippet: '- [ ] New task item\n- [ ] Second task item\n',
    },
    {
      title: 'Code Block',
      desc: 'Syntax highlighted code container',
      icon: Code,
      snippet: '```typescript\n// Write your code here\nconsole.log("Hello from Nook!");\n```\n',
    },
    {
      title: 'Quote Callout',
      desc: 'Highlighted note or warning',
      icon: Quote,
      snippet: '> **Important Note**: Key architectural requirement or guideline.\n',
    },
    {
      title: 'Markdown Table',
      desc: 'Tabular data structure',
      icon: Table,
      snippet: '| Feature | Status | Notes |\n| :--- | :--- | :--- |\n| Sandboxed Browser | Active | Human takeover enabled |\n| Bash Terminal | Active | Isolated container |\n',
    },
    {
      title: 'Divider Line',
      desc: 'Horizontal section separator',
      icon: Minus,
      snippet: '\n---\n',
    },
  ];

  return (
    <div className="absolute top-12 left-6 z-40 w-72 rounded-2xl bg-[#0f1624] border border-white/[0.12] shadow-2xl p-2 space-y-1 text-xs text-slate-200 animate-in fade-in zoom-in-95">
      <div className="px-2 py-1 text-[10px] uppercase font-semibold text-slate-400 border-b border-white/[0.06] flex items-center justify-between">
        <span>Insert Block</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-0.5 scrollbar-thin py-1">
        {commands.map((cmd, idx) => {
          const Icon = cmd.icon;
          return (
            <button
              key={idx}
              onClick={() => {
                onSelectCommand(cmd.snippet);
                onClose();
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] flex items-center gap-2.5 transition-colors group"
            >
              <div className="w-6 h-6 rounded-md bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 group-hover:text-indigo-400 group-hover:border-indigo-500/30">
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div>
                <p className="font-medium text-white text-xs leading-none mb-0.5">{cmd.title}</p>
                <p className="text-[10px] text-slate-400 leading-none">{cmd.desc}</p>
              </div>
            </button>
          );
        })}

        <div className="pt-1 border-t border-white/[0.06]">
          <button
            onClick={() => {
              onTriggerAgent();
              onClose();
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/20 text-indigo-300 flex items-center gap-2.5 transition-colors"
          >
            <div className="w-6 h-6 rounded-md bg-indigo-600/30 flex items-center justify-center text-indigo-300">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-semibold text-white text-xs leading-none mb-0.5">Ask AI Coworker</p>
              <p className="text-[10px] text-indigo-300 leading-none">Draft sections or revise document</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
