'use client';

import React from 'react';
import { RichMarkdown } from '@/components/ui/RichMarkdown';

interface MarkdownViewerProps {
  content: string;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content }) => {
  return (
    <div className="prose prose-invert max-w-none text-neutral-200 font-sans">
      <RichMarkdown content={content} />
    </div>
  );
};
