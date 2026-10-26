'use client';

import React, { useState } from 'react';
import { ReviewRequest } from '@/types';
import { 
  CheckCircle2, 
  XCircle, 
  FileText, 
  Terminal, 
  Clock, 
  ArrowRight, 
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { RichMarkdown } from '@/components/ui/RichMarkdown';

interface ReviewCardProps {
  review: ReviewRequest;
  onApprove: (reviewId: string) => void;
  onDecline: (reviewId: string, feedback?: string) => void;
  onRollback?: (reviewId: string) => void;
  onViewSavedPage?: (pageId: string) => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  review,
  onApprove,
  onDecline,
  onRollback,
  onViewSavedPage,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [previewTab, setPreviewTab] = useState<'content' | 'diff'>('content');

  const handleApprove = () => {
    try {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 },
      });
    } catch {
      // ignore
    }
    onApprove(review.id);
  };

  const handleDeclineSubmit = () => {
    onDecline(review.id, declineReason);
    setShowDeclineInput(false);
  };

  const quickDeclineSuggestions = [
    'Add more technical specifications',
    'Shorten overview section',
    'Include code snippets',
    'Verify command parameters',
  ];

  return (
    <div className={`mt-3 mb-2 rounded-2xl border transition-all duration-300 overflow-hidden shadow-xl ${
      review.status === 'approved'
        ? 'glass-card border-white/20 text-neutral-200'
        : review.status === 'declined'
        ? 'glass-card border-white/10 text-neutral-400 opacity-60'
        : 'glass-card apple-fluid-glow border-white/[0.14] text-neutral-200 shadow-2xl'
    }`}>
      {/* Header Bar */}
      <div className="p-4 flex items-center justify-between border-b border-white/[0.08] bg-black/30 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-white/[0.08] text-white flex items-center justify-center shrink-0 border border-white/[0.1] shadow-inner">
            {review.type === 'save_page' ? (
              <FileText className="w-4 h-4 text-white" />
            ) : (
              <Terminal className="w-4 h-4 text-white" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-tight text-white">
                Human-in-the-Loop Review
              </span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ${
                review.status === 'approved'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : review.status === 'declined'
                  ? 'bg-white/5 text-neutral-400 border border-white/10'
                  : 'bg-white text-black shadow-sm font-bold'
              }`}>
                {review.status === 'pending' ? 'Needs Approval' : review.status}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">{review.title}</p>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expandable Preview Body */}
      {isExpanded && (
        <div className="p-4 space-y-3.5">
          <p className="text-xs text-neutral-300 leading-relaxed">{review.description}</p>

          {/* Page Save Preview & Diff Toggle */}
          {review.type === 'save_page' && review.payload.pageContent && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-medium text-neutral-300 flex items-center gap-1.5 font-mono">
                  <Sparkles className="w-3.5 h-3.5 text-neutral-400" />
                  Target: {review.payload.pageTitle}
                </span>

                <div className="flex items-center bg-black/60 p-0.5 rounded-lg border border-white/[0.08] text-[10px]">
                  <button
                    onClick={() => setPreviewTab('content')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      previewTab === 'content'
                        ? 'bg-white text-black font-semibold shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Draft View
                  </button>
                  <button
                    onClick={() => setPreviewTab('diff')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      previewTab === 'diff'
                        ? 'bg-white text-black font-semibold shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    + Diff View
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-[#09090c]/90 border border-white/[0.08] p-4 text-xs max-h-72 overflow-y-auto scrollbar-thin text-neutral-200 shadow-inner">
                {previewTab === 'content' ? (
                  <RichMarkdown content={review.payload.pageContent} />
                ) : (
                  <div className="space-y-1 font-mono text-xs">
                    {review.payload.pageContent.split('\n').map((line, lIdx) => (
                      <div key={lIdx} className="bg-emerald-500/[0.08] text-emerald-300 pl-3 py-0.5 border-l-2 border-emerald-500/60 flex items-start gap-2">
                        <span className="text-emerald-500/60 select-none font-bold">+</span>
                        <span className="flex-1 whitespace-pre-wrap">{line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Terminal Command Preview */}
          {review.type === 'run_command' && review.payload.command && (
            <div className="rounded-lg bg-black/60 border border-white/[0.1] p-3 text-xs font-mono text-neutral-200">
              <div className="text-[11px] text-neutral-400 font-sans mb-1 flex items-center gap-1.5">
                <Terminal className="w-3 h-3 text-neutral-400" /> Target Sandbox Command:
              </div>
              <code className="text-white block bg-black/50 p-2 rounded border border-white/[0.08]">
                $ {review.payload.command}
              </code>
            </div>
          )}

          {/* Review Decision States */}
          {review.status === 'pending' && (
            <div>
              {showDeclineInput ? (
                <div className="space-y-2 mt-2 pt-2 border-t border-white/[0.08]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-neutral-400">Quick feedback:</span>
                    {quickDeclineSuggestions.map((sug, sIdx) => (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => setDeclineReason(sug)}
                        className="px-2 py-0.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-neutral-300 hover:text-white border border-white/[0.06]"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="Enter change request or reason for declining..."
                    className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-white/[0.1] text-xs text-neutral-200 outline-none focus:border-white/40"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDeclineSubmit}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.1] hover:bg-red-950/40 text-neutral-200 hover:text-red-300 border border-white/[0.1] text-xs font-medium transition-colors"
                    >
                      Confirm Decline
                    </button>
                    <button
                      onClick={() => setShowDeclineInput(false)}
                      className="px-3 py-1.5 rounded-lg text-neutral-400 hover:text-white text-xs hover:bg-white/[0.05]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    onClick={handleApprove}
                    className="flex-1 flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-neutral-200 text-black text-xs font-semibold shadow-sm transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4 text-black" />
                    {review.type === 'save_page' ? 'Approve & Save to Space' : 'Approve & Run in Sandbox'}
                  </button>

                  <button
                    onClick={() => setShowDeclineInput(true)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-neutral-400 hover:text-white border border-white/[0.08] text-xs font-medium transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    Decline
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Approved state badge & link */}
          {review.status === 'approved' && (
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Approved by you. Page created in Space!
              </span>
              <div className="flex items-center gap-3">
                {onRollback && review.type === 'save_page' && (
                  <button
                    onClick={() => onRollback(review.id)}
                    className="text-neutral-400 hover:text-amber-300 underline underline-offset-4 font-mono transition-colors text-xs"
                    title="Rollback this approved page creation"
                  >
                    Rollback
                  </button>
                )}
                {review.type === 'save_page' && onViewSavedPage && (
                  <button
                    onClick={() => onViewSavedPage(review.createdPageId || 'page-nook-brief')}
                    className="flex items-center gap-1 text-xs text-neutral-300 hover:text-white underline underline-offset-4 font-mono transition-colors"
                  >
                    View in Space <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Rolled back state badge */}
          {review.status === 'rolled_back' && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400 pt-1">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>Action rolled back. Document page removed from Space.</span>
            </div>
          )}

          {/* Declined state badge */}
          {review.status === 'declined' && (
            <div className="flex items-center gap-1.5 text-xs text-rose-400 pt-1">
              <XCircle className="w-4 h-4 text-rose-400" />
              <span>Declined. Agent notified with revision notes.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
