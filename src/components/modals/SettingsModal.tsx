'use client';

import React, { useState } from 'react';
import { LLMSettings, LLMProvider } from '@/types';
import { Settings2, Key, Cpu, Sparkles, Check, Server, Download, RotateCcw, X } from 'lucide-react';

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
  const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey);
  const [openaiApiKey, setOpenaiApiKey] = useState(settings.openaiApiKey);
  const [anthropicApiKey, setAnthropicApiKey] = useState(settings.anthropicApiKey);
  const [ollamaEndpoint, setOllamaEndpoint] = useState(settings.ollamaEndpoint);
  const [model, setModel] = useState(settings.model);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      provider,
      geminiApiKey: geminiApiKey.trim(),
      openaiApiKey: openaiApiKey.trim(),
      anthropicApiKey: anthropicApiKey.trim(),
      ollamaEndpoint: ollamaEndpoint.trim(),
      model,
      temperature,
    });
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl glass-card border border-white/[0.12] p-6 shadow-2xl space-y-5 text-neutral-200 font-sans animate-scale-in">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/[0.08] text-white border border-white/[0.1] flex items-center justify-center">
              <Settings2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-tight">Intelligence & Providers</h3>
              <p className="text-xs text-neutral-400">Configure LLM models and credentials</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-lg hover:bg-white/[0.08] text-neutral-400 hover:text-white transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Provider Selector */}
          <div>
            <label className="block text-neutral-300 mb-1.5 font-medium">Intelligence Provider</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setProvider('simulation')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
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
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
                  provider === 'gemini'
                    ? 'bg-white text-black font-semibold border-white shadow-sm'
                    : 'bg-[#18181b] border-white/[0.06] text-neutral-400 hover:text-white'
                }`}
              >
                <Cpu className={`w-4 h-4 shrink-0 ${provider === 'gemini' ? 'text-black' : 'text-neutral-400'}`} />
                <div className="min-w-0">
                  <p className={`font-semibold text-xs leading-tight ${provider === 'gemini' ? 'text-black' : 'text-white'}`}>Google Gemini</p>
                  <p className={`text-[10px] leading-tight ${provider === 'gemini' ? 'text-neutral-700' : 'text-neutral-500'}`}>1.5 Flash / Pro API</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('openai')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
                  provider === 'openai'
                    ? 'bg-white text-black font-semibold border-white shadow-sm'
                    : 'bg-[#18181b] border-white/[0.06] text-neutral-400 hover:text-white'
                }`}
              >
                <Key className={`w-4 h-4 shrink-0 ${provider === 'openai' ? 'text-black' : 'text-neutral-400'}`} />
                <div className="min-w-0">
                  <p className={`font-semibold text-xs leading-tight ${provider === 'openai' ? 'text-black' : 'text-white'}`}>OpenAI</p>
                  <p className={`text-[10px] leading-tight ${provider === 'openai' ? 'text-neutral-700' : 'text-neutral-500'}`}>GPT-4o / GPT-4o-mini</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('ollama')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
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
              <label className="block text-neutral-300 mb-1 font-medium">Gemini API Key</label>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40 font-mono text-xs"
              />
              <p className="text-[10px] text-neutral-500 mt-1">ai.google.dev API Key</p>
            </div>
          )}

          {provider === 'openai' && (
            <div>
              <label className="block text-neutral-300 mb-1 font-medium">OpenAI API Key</label>
              <input
                type="password"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/[0.1] text-white outline-none focus:border-white/40 font-mono text-xs"
              />
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
            </div>
          )}

          {provider === 'simulation' && (
            <div className="p-3 rounded-lg bg-[#18181b] border border-white/[0.08] text-neutral-300 text-xs">
              <p className="font-semibold text-white mb-0.5">Autonomous Simulation Active</p>
              <p className="text-[11px] text-neutral-400">
                AI Coworkers reason, browse real web URLs in sandbox computers, execute shell commands, and request human-in-the-loop review approvals without requiring API keys.
              </p>
            </div>
          )}

          {/* Workspace Backup & Restore */}
          <div className="pt-3 border-t border-white/[0.08] space-y-2">
            <span className="block text-neutral-300 font-medium">Workspace Data & Backup</span>
            <div className="flex items-center gap-2">
              {onExportWorkspace && (
                <button
                  type="button"
                  onClick={onExportWorkspace}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-neutral-300 hover:text-white border border-white/[0.08] text-xs transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Export Backup</span>
                </button>
              )}

              {onResetWorkspace && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Reset workspace to default agents and spaces? This clears local storage changes.')) {
                      onResetWorkspace();
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-red-950/30 text-neutral-400 hover:text-red-400 border border-white/[0.08] hover:border-red-500/30 text-xs transition-colors ml-auto"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold transition-colors shadow-sm"
            >
              {savedSuccess ? <Check className="w-4 h-4 text-black" /> : null}
              <span>{savedSuccess ? 'Saved' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
