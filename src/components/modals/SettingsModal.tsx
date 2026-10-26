'use client';

import React, { useState, useEffect } from 'react';
import { LLMSettings, LLMProvider } from '@/types';
import { Settings2, Key, Cpu, Sparkles, Check, Server, Download, RotateCcw, X, ShieldCheck } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: LLMSettings;
  onSaveSettings: (settings: LLMSettings) => void;
  onExportWorkspace?: () => void;
  onImportWorkspace?: (data: string) => void;
  onResetWorkspace?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onExportWorkspace,
  onResetWorkspace,
}) => {
  const [provider, setProvider] = useState<LLMProvider>(settings.provider);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [ollamaEndpoint, setOllamaEndpoint] = useState(settings.ollamaEndpoint || 'http://localhost:11434');
  const [model, setModel] = useState(settings.model);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverConfigured, setServerConfigured] = useState<{
    gemini?: boolean;
    openai?: boolean;
    anthropic?: boolean;
    ollama?: boolean;
  }>({});

  // Query server for active configured providers (secrets are never returned to client)
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.configuredProviders) {
          setServerConfigured(data.configuredProviders);
        }
        if (data?.provider) setProvider(data.provider);
        if (data?.model) setModel(data.model);
        if (typeof data?.temperature === 'number') setTemperature(data.temperature);
        if (data?.ollamaEndpoint) setOllamaEndpoint(data.ollamaEndpoint);
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    try {
      // 1. Save settings & secrets directly to server storage (never stored raw in localStorage)
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          temperature,
          ollamaEndpoint: ollamaEndpoint.trim(),
          geminiApiKey: geminiApiKey.trim() || undefined,
          openaiApiKey: openaiApiKey.trim() || undefined,
          anthropicApiKey: anthropicApiKey.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to update settings');
        return;
      }

      // Update client store with sanitized config (zero plaintext secrets in client state)
      onSaveSettings({
        provider,
        geminiApiKey: '',
        openaiApiKey: '',
        anthropicApiKey: '',
        ollamaEndpoint: ollamaEndpoint.trim(),
        model,
        temperature,
      });

      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error saving settings');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl glass-card border border-white/[0.12] p-6 shadow-2xl space-y-5 text-neutral-200 font-sans animate-scale-in">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/[0.08] text-white border border-white/[0.1] flex items-center justify-center">
              <Settings2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-tight">Intelligence & Providers</h3>
              <p className="text-xs text-neutral-400">Server-encrypted model credentials</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-lg hover:bg-white/[0.08] text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-xs animate-fade-in">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Provider Selector */}
          <div>
            <label className="block text-neutral-300 mb-1.5 font-medium">Intelligence Provider</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setProvider('simulation')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 cursor-pointer ${
                  provider === 'simulation'
                    ? 'bg-white text-black font-semibold border-white shadow-sm'
                    : 'bg-[#18181b] border-white/[0.06] text-neutral-400 hover:text-white'
                }`}
              >
                <Sparkles className={`w-4 h-4 shrink-0 ${provider === 'simulation' ? 'text-black' : 'text-neutral-400'}`} />
                <div className="min-w-0">
                  <p className={`font-semibold text-xs leading-tight ${provider === 'simulation' ? 'text-black' : 'text-white'}`}>Autonomous Demo</p>
                  <p className={`text-[10px] leading-tight ${provider === 'simulation' ? 'text-neutral-700' : 'text-neutral-500'}`}>Zero keys needed</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('gemini')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 cursor-pointer ${
                  provider === 'gemini'
                    ? 'bg-white text-black font-semibold border-white shadow-sm'
                    : 'bg-[#18181b] border-white/[0.06] text-neutral-400 hover:text-white'
                }`}
              >
                <Cpu className={`w-4 h-4 shrink-0 ${provider === 'gemini' ? 'text-black' : 'text-neutral-400'}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`font-semibold text-xs leading-tight ${provider === 'gemini' ? 'text-black' : 'text-white'}`}>Google Gemini</p>
                    {serverConfigured.gemini && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Configured on server" />}
                  </div>
                  <p className={`text-[10px] leading-tight ${provider === 'gemini' ? 'text-neutral-700' : 'text-neutral-500'}`}>1.5 Flash / Pro API</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('openai')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 cursor-pointer ${
                  provider === 'openai'
                    ? 'bg-white text-black font-semibold border-white shadow-sm'
                    : 'bg-[#18181b] border-white/[0.06] text-neutral-400 hover:text-white'
                }`}
              >
                <Key className={`w-4 h-4 shrink-0 ${provider === 'openai' ? 'text-black' : 'text-neutral-400'}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`font-semibold text-xs leading-tight ${provider === 'openai' ? 'text-black' : 'text-white'}`}>OpenAI</p>
                    {serverConfigured.openai && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Configured on server" />}
                  </div>
                  <p className={`text-[10px] leading-tight ${provider === 'openai' ? 'text-neutral-700' : 'text-neutral-500'}`}>GPT-4o / GPT-4o-mini</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('ollama')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 cursor-pointer ${
                  provider === 'ollama'
                    ? 'bg-white text-black font-semibold border-white shadow-sm'
                    : 'bg-[#18181b] border-white/[0.06] text-neutral-400 hover:text-white'
                }`}
              >
                <Server className={`w-4 h-4 shrink-0 ${provider === 'ollama' ? 'text-black' : 'text-neutral-400'}`} />
                <div className="min-w-0">
                  <p className={`font-semibold text-xs leading-tight ${provider === 'ollama' ? 'text-black' : 'text-white'}`}>Local Ollama</p>
                  <p className={`text-[10px] leading-tight ${provider === 'ollama' ? 'text-neutral-700' : 'text-neutral-500'}`}>Llama 3 / DeepSeek</p>
                </div>
              </button>
            </div>
          </div>

          {/* Dynamic Provider Configs */}
          {provider === 'gemini' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-neutral-300 font-medium">Gemini API Key</label>
                {serverConfigured.gemini && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Server Key Active
                  </span>
                )}
              </div>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder={serverConfigured.gemini ? '•••••••••••••••••••• (Leave blank to keep current)' : 'AIzaSy...'}
                className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40 font-mono text-xs"
              />
              <p className="text-[10px] text-neutral-500 mt-1">Saved securely in server storage. Never stored in browser localStorage.</p>
            </div>
          )}

          {provider === 'openai' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-neutral-300 font-medium">OpenAI API Key</label>
                {serverConfigured.openai && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Server Key Active
                  </span>
                )}
              </div>
              <input
                type="password"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                placeholder={serverConfigured.openai ? '•••••••••••••••••••• (Leave blank to keep current)' : 'sk-proj-...'}
                className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40 font-mono text-xs"
              />
              <p className="text-[10px] text-neutral-500 mt-1">Saved securely in server storage. Never stored in browser localStorage.</p>
            </div>
          )}

          {provider === 'ollama' && (
            <div>
              <label className="block text-neutral-300 mb-1 font-medium">Ollama Endpoint URL</label>
              <input
                type="text"
                value={ollamaEndpoint}
                onChange={(e) => setOllamaEndpoint(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40 font-mono text-xs"
              />
              <p className="text-[10px] text-neutral-500 mt-1">Must be an approved local endpoint (e.g. http://localhost:11434).</p>
            </div>
          )}

          {/* Model Selector */}
          <div>
            <label className="block text-neutral-300 mb-1 font-medium">Model Designation</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gemini-1.5-flash or gpt-4o"
              className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40 font-mono text-xs"
            />
          </div>

          {/* Temperature Slider */}
          <div>
            <div className="flex items-center justify-between text-neutral-400 mb-1">
              <span>Reasoning Temperature</span>
              <span className="font-mono text-white">{temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-white"
            />
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-white/[0.08]">
            <div className="flex items-center gap-2">
              {onExportWorkspace && (
                <button
                  type="button"
                  onClick={onExportWorkspace}
                  className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-neutral-300 border border-white/[0.06] text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Export workspace JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
              )}
              {onResetWorkspace && (
                <button
                  type="button"
                  onClick={onResetWorkspace}
                  className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-red-950/40 text-neutral-400 hover:text-red-300 border border-white/[0.06] text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Reset to factory defaults"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Configuration</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
