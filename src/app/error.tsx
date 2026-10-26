'use client';

import React, { useEffect } from 'react';
import { RotateCcw, AlertCircle, Home } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Nook Workspace Runtime Error:', error);
  }, [error]);

  const handleResetStorage = () => {
    try {
      localStorage.removeItem('nook_agents');
      localStorage.removeItem('nook_spaces');
      localStorage.removeItem('nook_settings');
    } catch {}
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-neutral-200 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-[#141414] border border-white/[0.1] p-8 shadow-2xl text-center space-y-5">
        <div className="w-12 h-12 rounded-full bg-white/[0.06] border border-white/[0.1] flex items-center justify-center mx-auto text-neutral-300">
          <AlertCircle className="w-6 h-6" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-white tracking-tight">Workspace Interrupted</h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Nook encountered an unexpected client error. Your persistent space data is safe.
          </p>
          {error?.message && (
            <p className="text-[11px] font-mono text-neutral-500 bg-black/40 p-2 rounded-lg border border-white/[0.05] truncate">
              {error.message}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-semibold shadow-sm transition-all active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </button>

          <button
            onClick={handleResetStorage}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-neutral-400 hover:text-white border border-white/[0.08] text-xs font-medium transition-colors"
            title="Clear cached state and reload defaults"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Reset Cache</span>
          </button>
        </div>
      </div>
    </div>
  );
}
