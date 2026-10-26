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

interface ReviewCardProps {
  review: ReviewRequest;
  onApprove: (reviewId: string) => void;
  onDecline: (reviewId: string, feedback?: string) => void;
  onViewSavedPage?: (pageId: string) => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  review,
  onApprove,
  onDecline,
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
    <div className={`mt-3 mb-2 rounded-xl border transition-all duration-200 overflow-hidden shadow-lg ${
      review.status === 'approved'
        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
        : review.status === 'declined'
        ? 'bg-rose-950/20 border-rose-500/30 text-rose-200'
        : 'bg-[#131b26] border-indigo-500/30 text-slate-200 ring-1 ring-indigo-500/20'
    }`}>
      {/* Header Bar */}
      <div className="p-3.5 flex items-center justify-between border-b border-white/[0.06] bg-black/20">
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
            review.type === 'save_page'
              ? 'bg-indigo-500/20 text-indigo-400'
              : 'bg-amber-500/20 text-amber-400'
          }`}>
            {review.type === 'save_page' ? (
              <FileText className="w-4 h-4" />
            ) : (
              <Terminal className="w-4 h-4" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wide text-white">
                Human-in-the-Loop Review
              </span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${
                review.status === 'approved'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : review.status === 'declined'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
              }`}>
                {review.status === 'pending' ? 'Needs Approval' : review.status}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">{review.title}</p>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/[0.05]"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expandable Preview Body */}
      {isExpanded && (
        <div className="p-3.5 space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">{review.description}</p>

          {/* Page Save Preview & Diff Toggle */}
          {review.type === 'save_page' && review.payload.pageContent && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-medium text-indigo-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Target: {review.payload.pageTitle}
                </span>

                <div className="flex items-center bg-black/40 p-0.5 rounded-md border border-white/[0.06] text-[10px]">
                  <button
                    onClick={() => setPreviewTab('content')}
                    className={`px-2 py-0.5 rounded ${
                      previewTab === 'content'
                        ? 'bg-white/[0.12] text-white font-medium'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Draft View
                  </button>
                  <button
                    onClick={() => setPreviewTab('diff')}
                    className={`px-2 py-0.5 rounded ${
                      previewTab === 'diff'
                        ? 'bg-emerald-500/20 text-emerald-300 font-medium'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    + Diff View
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-black/40 border border-white/[0.08] p-3 text-xs font-mono max-h-56 overflow-y-auto scrollbar-thin text-slate-300">
                {previewTab === 'content' ? (
                  <pre className="whitespace-pre-wrap leading-relaxed">{review.payload.pageContent}</pre>
                ) : (
                  <div className="space-y-0.5">
                    {review.payload.pageContent.split('\n').map((line, lIdx) => (
                      <div key={lIdx} className="bg-emerald-950/20 text-emerald-300 pl-2 py-0.5 border-l-2 border-emerald-500/40">
                        <span className="text-emerald-500 select-none mr-2">+</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Terminal Command Preview */}
          {review.type === 'run_command' && review.payload.command && (
            <div className="rounded-lg bg-black/60 border border-amber-500/20 p-3 text-xs font-mono text-amber-300">
              <div className="text-[11px] text-slate-400 font-sans mb-1 flex items-center gap-1.5">
                <Terminal className="w-3 h-3 text-amber-400" /> Target Sandbox Command:
              </div>
              <code className="text-amber-200 block bg-black/40 p-2 rounded border border-white/[0.05]">
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
                    <span className="text-[10px] text-slate-400">Quick feedback:</span>
                    {quickDeclineSuggestions.map((sug, sIdx) => (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => setDeclineReason(sug)}
                        className="px-2 py-0.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-slate-300 hover:text-white border border-white/[0.06]"
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
                    className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-white/[0.1] text-xs text-slate-200 outline-none focus:border-rose-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDeclineSubmit}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors"
                    >
                      Confirm Decline
                    </button>
                    <button
                      onClick={() => setShowDeclineInput(false)}
                      className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs hover:bg-white/[0.05]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    onClick={handleApprove}
                    className="flex-1 flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-900/40 transition-all hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {review.type === 'save_page' ? 'Approve & Save to Space' : 'Approve & Run in Sandbox'}
                  </button>

                  <button
                    onClick={() => setShowDeclineInput(true)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-white/[0.08] hover:border-rose-500/30 text-xs font-medium transition-colors"
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
            <div className="flex items-center justify-between text-xs text-emerald-400 pt-1">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Approved by you. Page created in Space!
              </span>
              {review.type === 'save_page' && onViewSavedPage && (
                <button
                  onClick={() => onViewSavedPage('page-nook-brief')}
                  className="flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-100 underline underline-offset-4"
                >
                  View in Space <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
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
