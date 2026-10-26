'use client';

import React, { useState } from 'react';
import { LLMSettings, LLMProvider } from '@/types';
import { Settings2, Key, Cpu, Sparkles, Check, Server, Download, Upload, RotateCcw } from 'lucide-react';

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
  onImportWorkspace,
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
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#0e1420] border border-white/[0.12] p-6 shadow-2xl space-y-5 text-slate-200">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Settings2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Nook Intelligence & Settings</h3>
              <p className="text-xs text-slate-400">Configure multi-provider LLM models and API credentials</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Provider Selector */}
          <div>
            <label className="block text-slate-300 mb-1.5 font-medium">Intelligence Provider</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setProvider('simulation')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2 ${
                  provider === 'simulation'
                    ? 'bg-indigo-600/20 border-indigo-500/40 text-white ring-1 ring-indigo-500/30'
                    : 'bg-black/30 border-white/[0.06] text-slate-400 hover:text-slate-300'
                }`}
              >
                <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                <div>
                  <p className="font-semibold text-xs text-white">Autonomous Demo Engine</p>
                  <p className="text-[10px] text-slate-400">Works out of the box (zero keys needed)</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('gemini')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2 ${
                  provider === 'gemini'
                    ? 'bg-blue-600/20 border-blue-500/40 text-white ring-1 ring-blue-500/30'
                    : 'bg-black/30 border-white/[0.06] text-slate-400 hover:text-slate-300'
                }`}
              >
                <Cpu className="w-4 h-4 text-blue-400 shrink-0" />
                <div>
                  <p className="font-semibold text-xs text-white">Google Gemini</p>
                  <p className="text-[10px] text-slate-400">Gemini 1.5 Flash / Pro API</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('openai')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2 ${
                  provider === 'openai'
                    ? 'bg-emerald-600/20 border-emerald-500/40 text-white ring-1 ring-emerald-500/30'
                    : 'bg-black/30 border-white/[0.06] text-slate-400 hover:text-slate-300'
                }`}
              >
                <Key className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="font-semibold text-xs text-white">OpenAI</p>
                  <p className="text-[10px] text-slate-400">GPT-4o / GPT-4o-mini</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('ollama')}
                className={`p-2.5 rounded-lg border text-left transition-colors flex items-center gap-2 ${
                  provider === 'ollama'
                    ? 'bg-amber-600/20 border-amber-500/40 text-white ring-1 ring-amber-500/30'
                    : 'bg-black/30 border-white/[0.06] text-slate-400 hover:text-slate-300'
                }`}
              >
                <Server className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <p className="font-semibold text-xs text-white">Local Ollama</p>
                  <p className="text-[10px] text-slate-400">Llama 3, DeepSeek, Mistral</p>
                </div>
              </button>
            </div>
          </div>

          {/* Dynamic Provider Configs */}
          {provider === 'gemini' && (
            <div>
              <label className="block text-slate-300 mb-1 font-medium">Gemini API Key</label>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none focus:border-blue-500 font-mono text-xs"
              />
              <p className="text-[10px] text-slate-400 mt-1">Get your free API key at ai.google.dev</p>
            </div>
          )}

          {provider === 'openai' && (
            <div>
              <label className="block text-slate-300 mb-1 font-medium">OpenAI API Key</label>
              <input
                type="password"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none focus:border-emerald-500 font-mono text-xs"
              />
            </div>
          )}

          {provider === 'ollama' && (
            <div>
              <label className="block text-slate-300 mb-1 font-medium">Ollama Endpoint URL</label>
              <input
                type="text"
                value={ollamaEndpoint}
                onChange={(e) => setOllamaEndpoint(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/[0.1] text-slate-100 outline-none focus:border-amber-500 font-mono text-xs"
              />
            </div>
          )}

          {provider === 'simulation' && (
            <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-indigo-300 text-xs">
              <p className="font-semibold text-white mb-0.5">Autonomous Simulation Active</p>
              <p className="text-[11px] text-slate-400">
                AI Coworkers will reason, navigate real web URLs on their computers, run shell scripts in the sandbox, and present human-in-the-loop review cards without requiring external API keys.
              </p>
            </div>
          )}

          {/* Workspace Backup & Restore */}
          <div className="pt-3 border-t border-white/[0.08] space-y-2">
            <span className="block text-slate-300 font-medium">Workspace Data & Backup</span>
            <div className="flex items-center gap-2">
              {onExportWorkspace && (
                <button
                  type="button"
                  onClick={onExportWorkspace}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/[0.08] text-xs transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Export Backup</span>
                </button>
              )}

              {onResetWorkspace && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Reset workspace to factory default agents and spaces? This will clear local changes.')) {
                      onResetWorkspace();
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 text-xs transition-colors ml-auto"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Factory Reset</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors shadow-lg shadow-indigo-900/30"
            >
              {savedSuccess ? <Check className="w-4 h-4 text-emerald-400" /> : null}
              <span>{savedSuccess ? 'Saved!' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
