'use client';

import React, { useState } from 'react';
import { Lock, KeyRound, AlertTriangle, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';

interface AuthBarrierProps {
  isSetupConfigured: boolean;
  onAuthenticated: () => void;
}

export const AuthBarrier: React.FC<AuthBarrierProps> = ({
  isSetupConfigured,
  onAuthenticated,
}) => {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    try {
      setIsLoading(true);
      setErrorMessage(null);

      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      onAuthenticated();
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#070709] px-4 select-none">
      {/* Background glow effect */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-600/[0.04] rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10 p-6 rounded-2xl bg-[#0f0f14]/90 border border-white/[0.08] shadow-2xl backdrop-blur-xl">
        {/* Header Emblem */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-white text-black flex items-center justify-center shadow-lg mb-3">
            <div className="w-3.5 h-3.5 rounded-full bg-black" />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-white flex items-center gap-1.5">
            Nook OS
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-neutral-400 border border-white/[0.08]">
              Owner Access
            </span>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Single-user autonomous AI coworker environment
          </p>
        </div>

        {/* Setup Incomplete Notice */}
        {!isSetupConfigured ? (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs space-y-2">
            <div className="flex items-center gap-2 font-medium text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Server Setup Incomplete</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-200/80">
              To prevent unauthorized internet access, Nook strictly fails closed until configured. Set <code className="bg-black/40 px-1 py-0.5 rounded font-mono text-amber-300">NOOK_API_KEY</code> or <code className="bg-black/40 px-1 py-0.5 rounded font-mono text-amber-300">NOOK_PASSWORD</code> in your server environment to authenticate.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 uppercase font-mono tracking-wider mb-1.5">
                Owner Password or Master Key
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter NOOK_API_KEY or password..."
                  autoFocus
                  required
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#15151c] border border-white/[0.08] focus:border-white/30 text-xs text-white placeholder:text-neutral-500 outline-none transition-colors"
                />
                <KeyRound className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5 pointer-events-none" />
              </div>
            </div>

            {errorMessage && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 shrink-0 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !password.trim()}
              className="w-full py-2 px-4 rounded-xl bg-white hover:bg-neutral-200 disabled:opacity-40 text-black text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <span>Unlock Workspace</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Footer Security Badge */}
        <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-neutral-500 font-mono">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            HMAC Protected
          </span>
          <span>Zero-Leak Cookies</span>
        </div>
      </div>
    </div>
  );
};
