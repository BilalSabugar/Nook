'use client';

import React from 'react';
import { Check, Copy } from 'lucide-react';

interface RichMarkdownProps {
  content: string;
  className?: string;
}

export const RichMarkdown: React.FC<RichMarkdownProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // Split into lines for block-level processing
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = '';

  let inTable = false;
  let tableHeaderRow: string[] = [];
  let tableRows: string[][] = [];

  const flushTable = (keyPrefix: string) => {
    if (!inTable) return null;
    const tableEl = (
      <div key={keyPrefix} className="my-3 w-full overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0c0c0e]/80 backdrop-blur-md shadow-sm">
        <table className="w-full text-left text-xs border-collapse">
          {tableHeaderRow.length > 0 && (
            <thead className="bg-white/[0.04] border-b border-white/[0.08] text-neutral-300 font-mono">
              <tr>
                {tableHeaderRow.map((cell, idx) => (
                  <th key={idx} className="py-2.5 px-3.5 font-semibold text-neutral-200">
                    {formatInline(cell.trim())}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-white/[0.04]">
            {tableRows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-white/[0.02] transition-colors">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="py-2.5 px-3.5 text-neutral-300 leading-relaxed">
                    {formatInline(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    inTable = false;
    tableHeaderRow = [];
    tableRows = [];
    return tableEl;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine;

    // Code block delimiters
    if (line.trim().startsWith('```')) {
      if (inTable) {
        elements.push(flushTable(`table-${i}`));
      }
      if (inCodeBlock) {
        // End code block
        const codeContent = codeBlockLines.join('\n');
        elements.push(
          <div key={`codeblock-${i}`} className="my-3 rounded-xl bg-[#09090b] border border-white/[0.08] overflow-hidden text-xs font-mono shadow-sm">
            {codeBlockLang && (
              <div className="px-3.5 py-1.5 bg-white/[0.03] border-b border-white/[0.06] text-neutral-400 text-[10px] uppercase font-semibold flex items-center justify-between">
                <span>{codeBlockLang}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(codeContent)}
                  className="hover:text-white transition-colors text-[10px] flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
              </div>
            )}
            <pre className="p-3.5 text-neutral-200 overflow-x-auto whitespace-pre leading-relaxed select-text font-mono">
              {codeContent}
            </pre>
          </div>
        );
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = '';
      } else {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Table parsing (| col | col |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());

      // Check if it's the divider row (| :--- | :--- |)
      const isDivider = cells.every((c) => /^:?-+:?$/.test(c.trim()));

      if (isDivider) {
        // Ignore separator line, just mark inTable
        inTable = true;
      } else if (!inTable) {
        // This is the header row
        inTable = true;
        tableHeaderRow = cells;
      } else {
        // Body row
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      // Line is not a table row anymore, flush the completed table
      elements.push(flushTable(`table-${i}`));
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${i}`} className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-4 mb-2 pb-1.5 border-b border-white/[0.08]">
          {formatInline(line.slice(2))}
        </h1>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-base sm:text-lg font-semibold text-white tracking-tight mt-3.5 mb-1.5">
          {formatInline(line.slice(3))}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-sm sm:text-base font-semibold text-neutral-100 tracking-tight mt-3 mb-1">
          {formatInline(line.slice(4))}
        </h3>
      );
      continue;
    }
    if (line.startsWith('#### ')) {
      elements.push(
        <h4 key={`h4-${i}`} className="text-xs sm:text-sm font-medium text-neutral-200 tracking-tight mt-2 mb-1">
          {formatInline(line.slice(5))}
        </h4>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={`quote-${i}`} className="my-2.5 pl-3.5 border-l-2 border-white/40 bg-white/[0.02] py-1.5 pr-3 rounded-r-lg text-neutral-300 italic text-xs sm:text-sm">
          {formatInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Task Checklist
    if (line.trim().startsWith('- [ ] ') || line.trim().startsWith('* [ ] ')) {
      elements.push(
        <div key={`task-${i}`} className="flex items-center gap-2 my-1 text-xs sm:text-sm text-neutral-300">
          <span className="w-3.5 h-3.5 rounded border border-white/30 flex items-center justify-center shrink-0 bg-white/[0.04]" />
          <span>{formatInline(line.trim().slice(6))}</span>
        </div>
      );
      continue;
    }
    if (line.trim().startsWith('- [x] ') || line.trim().startsWith('- [X] ') || line.trim().startsWith('* [x] ')) {
      elements.push(
        <div key={`task-done-${i}`} className="flex items-center gap-2 my-1 text-xs sm:text-sm text-neutral-400 line-through">
          <span className="w-3.5 h-3.5 rounded bg-white text-black flex items-center justify-center shrink-0">
            <Check className="w-2.5 h-2.5 stroke-[3]" />
          </span>
          <span>{formatInline(line.trim().slice(6))}</span>
        </div>
      );
      continue;
    }

    // Bullet items
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <div key={`bullet-${i}`} className="flex items-start gap-2 my-0.5 pl-1.5 text-xs sm:text-sm text-neutral-300 leading-relaxed">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 mt-2 shrink-0 opacity-70" />
          <span className="flex-1">{formatInline(line.trim().slice(2))}</span>
        </div>
      );
      continue;
    }

    // Numbered lists
    const numMatch = line.trim().match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      elements.push(
        <div key={`num-${i}`} className="flex items-start gap-2 my-0.5 pl-1 text-xs sm:text-sm text-neutral-300 leading-relaxed">
          <span className="font-mono text-neutral-400 text-xs shrink-0 font-medium">{numMatch[1]}.</span>
          <span className="flex-1">{formatInline(numMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Horizontal rule
    if (line.trim() === '---' || line.trim() === '***') {
      elements.push(<hr key={`hr-${i}`} className="my-4 border-white/[0.08]" />);
      continue;
    }

    // Empty lines
    if (!line.trim()) {
      elements.push(<div key={`empty-${i}`} className="h-1.5" />);
      continue;
    }

    // Standard paragraph with rich inline formatting
    elements.push(
      <p key={`p-${i}`} className="text-xs sm:text-sm leading-relaxed text-neutral-200 my-1">
        {formatInline(line)}
      </p>
    );
  }

  if (inTable) {
    elements.push(flushTable('table-end'));
  }

  return (
    <div className={`space-y-0.5 text-neutral-200 leading-relaxed selection:bg-white/20 select-text ${className}`}>
      {elements}
    </div>
  );
};

/**
 * Parses inline formatting:
 * - Bold: **text** or __text__
 * - Italic: *text* or _text_
 * - Inline Code: `code`
 * - Links: [text](url)
 */
function formatInline(text: string): React.ReactNode {
  if (!text) return '';

  // Regex patterns for inline markdown tokens
  // Matches: `code`, **bold**, *italic*, [link](url)
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;

  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (!part) return null;

    // Inline code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={index}
          className="px-1.5 py-0.5 mx-0.5 rounded-md bg-white/[0.08] text-white border border-white/[0.1] font-mono text-[11px] font-medium tracking-tight"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold: **text** or __text__
    if (
      (part.startsWith('**') && part.endsWith('**') && part.length > 4) ||
      (part.startsWith('__') && part.endsWith('__') && part.length > 4)
    ) {
      return (
        <strong key={index} className="text-white font-semibold tracking-normal">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // Italic: *text* or _text_
    if (
      (part.startsWith('*') && part.endsWith('*') && part.length > 2) ||
      (part.startsWith('_') && part.endsWith('_') && part.length > 2)
    ) {
      return (
        <em key={index} className="text-neutral-200 italic">
          {part.slice(1, -1)}
        </em>
      );
    }

    // Link: [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-white underline decoration-white/40 underline-offset-2 hover:decoration-white transition-colors"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return part;
  });
}
