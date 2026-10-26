'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Agent, Message, ReviewRequest } from '@/types';
import { ReviewCard } from '@/components/review/ReviewCard';
import { 
  Send, 
  Sparkles, 
  Terminal, 
  Globe, 
  FilePlus, 
  ChevronDown, 
  ChevronRight, 
  CheckCircle, 
  Bot, 
  User, 
  Monitor, 
  Phone,
  Copy,
  Check,
  CornerDownLeft,
  AtSign
} from 'lucide-react';
import { VoiceCallModal } from '@/components/chat/VoiceCallModal';

interface AgentChatProps {
  agent: Agent;
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string) => void;
  onApproveReview: (reviewId: string) => void;
  onDeclineReview: (reviewId: string, feedback?: string) => void;
  onSwitchToComputer: () => void;
  onViewSavedPage?: (pageId: string) => void;
}

export const AgentChat: React.FC<AgentChatProps> = ({
  agent,
  messages,
  isLoading,
  onSendMessage,
  onApproveReview,
  onDeclineReview,
  onSwitchToComputer,
  onViewSavedPage,
}) => {
  const [inputText, setInputText] = useState('');
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const toggleThoughts = (msgId: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const copyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  // Quick Action Prompts
  const quickPrompts = [
    { label: 'Browse OpenDots Repo', text: 'Browse https://github.com/CopilotKit/OpenDots and inspect its architecture', icon: Globe },
    { label: 'Draft Launch Brief', text: 'Draft a comprehensive Launch Brief for our Spaces and request my review', icon: FilePlus },
    { label: 'Run Sandbox Command', text: 'Run npm test in your container sandbox and show me the output', icon: Terminal },
    { label: 'Summarize Workspace', text: 'Review all living spaces and summarize our current engineering roadmap', icon: Sparkles },
  ];

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#070b12] text-slate-200 overflow-hidden relative">
      {/* Ambient background glows */}
      <div className="absolute top-10 right-20 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-20 left-20 w-80 h-80 bg-emerald-600/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Bar */}
      <div className="h-16 px-6 border-b border-white/[0.08] bg-[#0c1017]/90 backdrop-blur-md flex items-center justify-between shrink-0 relative z-10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="relative group">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.1] flex items-center justify-center text-xl shadow-inner">
              {agent.avatar}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0c1017] shadow-xs shadow-emerald-400" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white text-base tracking-tight">{agent.name}</h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 border border-white/[0.08]">
                {agent.role}
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-400">{agent.statusMessage || 'Always-on coworker'}</span>
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsCallModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-medium transition-all shadow-sm shadow-emerald-900/30 active:scale-95"
          >
            <div className="flex items-center gap-0.5">
              <span className="w-1 h-2 rounded-full bg-emerald-400 wave-bar-1" />
              <span className="w-1 h-3 rounded-full bg-emerald-400 wave-bar-2" />
              <span className="w-1 h-2 rounded-full bg-emerald-400 wave-bar-3" />
            </div>
            <Phone className="w-3.5 h-3.5 ml-1" />
            <span>Call {agent.name}</span>
          </button>

          {agent.computerEnabled && (
            <button
              onClick={onSwitchToComputer}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-all shadow-sm shadow-indigo-900/30 active:scale-95"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>{agent.name}&apos;s Computer</span>
            </button>
          )}
        </div>
      </div>

      {/* Voice Call Modal */}
      <VoiceCallModal
        isOpen={isCallModalOpen}
        agent={agent}
        onEndCall={() => setIsCallModalOpen(false)}
      />

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin relative z-10">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3.5 max-w-3xl group ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
            >
              {/* Avatar Icon */}
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-sm shadow-md ${
                isUser 
                  ? 'bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-indigo-900/40' 
                  : 'bg-[#121824] border border-white/[0.1] text-base'
              }`}>
                {isUser ? <User className="w-4 h-4" /> : agent.avatar}
              </div>

              {/* Message Bubble & Content */}
              <div className={`space-y-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                {/* Reasoning Thought Trace Accordion */}
                {!isUser && msg.thoughtProcess && msg.thoughtProcess.length > 0 && (
                  <div className="rounded-xl bg-[#0d131e]/90 border border-indigo-500/20 p-3 text-xs text-slate-400 shadow-sm">
                    <button
                      onClick={() => toggleThoughts(msg.id)}
                      className="flex items-center gap-2 font-mono text-[11px] text-indigo-300 hover:text-indigo-200 w-full text-left"
                    >
                      {expandedThoughts[msg.id] ? (
                        <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-indigo-400" />
                      )}
                      <span className="font-semibold">Reasoning Trace ({msg.thoughtProcess.length} steps)</span>
                    </button>

                    {expandedThoughts[msg.id] && (
                      <ul className="mt-2.5 space-y-1.5 pl-3 border-l-2 border-indigo-500/30 text-[11px] text-slate-300 font-mono">
                        {msg.thoughtProcess.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-indigo-400 font-bold">[{idx + 1}]</span>
                            <span className="leading-relaxed">{step}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Tool Invocations Card */}
                {!isUser && msg.toolCall && (
                  <div className="rounded-xl bg-[#0c1424] border border-blue-500/30 p-3 text-xs flex items-center gap-3 text-blue-200 shadow-sm shadow-blue-950/40">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0 border border-blue-500/30">
                      <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] text-blue-300 font-semibold">Tool Executed: {msg.toolCall.toolName}</span>
                      {msg.toolCall.output && (
                        <p className="text-[11px] text-slate-300 mt-0.5 truncate font-mono">{msg.toolCall.output}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Text Bubble */}
                <div className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap relative ${
                  isUser
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-none shadow-lg shadow-indigo-950/40 border border-indigo-500/30'
                    : 'bg-[#0f1523]/90 backdrop-blur-md border border-white/[0.08] text-slate-100 rounded-tl-none shadow-md shadow-black/40'
                }`}>
                  {msg.content}

                  {/* Copy button on hover */}
                  <button
                    onClick={() => copyMessage(msg.id, msg.content)}
                    className="absolute -bottom-2 -right-2 p-1 rounded-md bg-[#162032] border border-white/[0.1] text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    title="Copy message"
                  >
                    {copiedMessageId === msg.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>

                {/* Human-in-the-loop Review Card */}
                {!isUser && msg.reviewRequest && (
                  <ReviewCard
                    review={msg.reviewRequest}
                    onApprove={onApproveReview}
                    onDecline={onDeclineReview}
                    onViewSavedPage={onViewSavedPage}
                  />
                )}

                <div className="flex items-center gap-2 px-1 text-[10px] text-slate-500">
                  <span>{msg.timestamp}</span>
                  {!isUser && <span>• {agent.name}</span>}
                </div>
              </div>
            </div>
          );
        })}

        {/* Loading / Thinking Indicator */}
        {isLoading && (
          <div className="flex gap-3.5 items-center text-xs text-slate-300 mr-auto">
            <div className="w-8 h-8 rounded-xl bg-[#121824] border border-white/[0.1] flex items-center justify-center text-base">
              {agent.avatar}
            </div>
            <div className="flex items-center gap-3 bg-[#0f1523]/90 backdrop-blur-md border border-indigo-500/30 px-4 py-2.5 rounded-2xl shadow-lg">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-pink-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="shimmer-text font-medium text-xs">{agent.name} is thinking & analyzing...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Bar */}
      <div className="px-6 py-2.5 bg-[#0a0e16]/80 backdrop-blur-md border-t border-white/[0.06] flex items-center gap-2 overflow-x-auto scrollbar-none relative z-10">
        <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider shrink-0 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Quick Actions:
        </span>
        {quickPrompts.map((p, idx) => {
          const Icon = p.icon;
          return (
            <button
              key={idx}
              onClick={() => onSendMessage(p.text)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.06] hover:border-indigo-500/30 text-xs transition-all shrink-0 active:scale-95"
            >
              <Icon className="w-3 h-3 text-indigo-400" />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Message Input Bar */}
      <div className="p-4 bg-[#0a0e16]/95 backdrop-blur-md border-t border-white/[0.08] relative z-10">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
          <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-black/50 border border-white/[0.1] focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all shadow-inner">
            <span className="text-slate-500 text-xs flex items-center gap-1 font-mono">
              <AtSign className="w-3.5 h-3.5 text-indigo-400" />
            </span>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Message ${agent.name} or type @Agent to collaborate...`}
              disabled={isLoading}
              className="bg-transparent border-none outline-none text-slate-100 placeholder:text-slate-500 w-full text-xs sm:text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="p-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 disabled:opacity-40 text-white font-semibold transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center active:scale-95"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
