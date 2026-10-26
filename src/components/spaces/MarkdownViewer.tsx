'use client';

import React from 'react';

interface MarkdownViewerProps {
  content: string;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content }) => {
  // Simple, fast, secure client-side markdown formatter
  const lines = content.split('\n');
  const renderedElements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        renderedElements.push(
          <div key={`code-${i}`} className="my-4 rounded-xl bg-[#0a0a0a] border border-white/[0.1] overflow-hidden font-mono text-xs">
            {codeBlockLang && (
              <div className="px-4 py-1.5 bg-white/[0.04] border-b border-white/[0.06] text-neutral-400 text-[10px] uppercase font-semibold">
                {codeBlockLang}
              </div>
            )}
            <pre className="p-4 text-neutral-200 overflow-x-auto whitespace-pre leading-relaxed">
              {codeBlockContent.join('\n')}
            </pre>
          </div>
        );
        inCodeBlock = false;
        codeBlockContent = [];
        codeBlockLang = '';
      } else {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3);
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      renderedElements.push(
        <h1 key={i} className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-6 mb-3 pb-2 border-b border-white/[0.08]">
          {line.slice(2)}
        </h1>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      renderedElements.push(
        <h2 key={i} className="text-xl sm:text-2xl font-semibold text-white tracking-tight mt-5 mb-2.5">
          {line.slice(3)}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      renderedElements.push(
        <h3 key={i} className="text-lg font-semibold text-neutral-100 tracking-tight mt-4 mb-2">
          {line.slice(4)}
        </h3>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      renderedElements.push(
        <blockquote key={i} className="my-3 pl-4 border-l-2 border-white/40 bg-white/[0.03] py-1.5 pr-3 rounded-r-lg text-neutral-300 italic text-sm">
          {line.slice(2)}
        </blockquote>
      );
      continue;
    }

    // Task Checklist
    if (line.trim().startsWith('- [ ] ')) {
      renderedElements.push(
        <div key={i} className="flex items-center gap-2.5 my-1.5 text-sm text-neutral-300">
          <input type="checkbox" readOnly checked={false} className="rounded accent-white w-4 h-4 cursor-pointer" />
          <span>{line.trim().slice(6)}</span>
        </div>
      );
      continue;
    }
    if (line.trim().startsWith('- [x] ') || line.trim().startsWith('- [X] ')) {
      renderedElements.push(
        <div key={i} className="flex items-center gap-2.5 my-1.5 text-sm text-neutral-400 line-through">
          <input type="checkbox" readOnly checked={true} className="rounded accent-white w-4 h-4" />
          <span>{line.trim().slice(6)}</span>
        </div>
      );
      continue;
    }

    // Bullet item
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      renderedElements.push(
        <div key={i} className="flex items-start gap-2.5 my-1 pl-2 text-sm text-neutral-300">
          <span className="text-neutral-500 mt-1">●</span>
          <span>{line.trim().slice(2)}</span>
        </div>
      );
      continue;
    }

    // Horizontal rule
    if (line.trim() === '---' || line.trim() === '***') {
      renderedElements.push(<hr key={i} className="my-6 border-white/[0.08]" />);
      continue;
    }

    // Empty lines
    if (!line.trim()) {
      renderedElements.push(<div key={i} className="h-2" />);
      continue;
    }

    // Standard paragraph with inline formatting
    renderedElements.push(
      <p key={i} className="text-sm sm:text-base leading-relaxed text-neutral-300 my-1.5">
        {line}
      </p>
    );
  }

  return (
    <div className="space-y-1 prose prose-invert max-w-none text-neutral-200 font-sans">
      {renderedElements}
    </div>
  );
};
