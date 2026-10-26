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
  Maximize2,
  Phone
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

  // Quick Action Prompts
  const quickPrompts = [
    { label: 'Browse OpenDots Repo', text: 'Browse https://github.com/CopilotKit/OpenDots and inspect its architecture', icon: Globe },
    { label: 'Draft Launch Brief', text: 'Draft a comprehensive Launch Brief for our Spaces and request my review', icon: FilePlus },
    { label: 'Run Sandbox Command', text: 'Run npm test in your container sandbox and show me the output', icon: Terminal },
  ];

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#070b12] text-slate-200 overflow-hidden">
      {/* Header Bar */}
      <div className="h-16 px-6 border-b border-white/[0.08] bg-[#0c1017] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="text-2xl">{agent.avatar}</span>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0c1017]" />
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
              {agent.statusMessage || 'Always-on coworker'}
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCallModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-medium transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>Call {agent.name}</span>
          </button>

          {agent.computerEnabled && (
            <button
              onClick={onSwitchToComputer}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-colors"
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
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
            >
              {/* Avatar Icon */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm ${
                isUser ? 'bg-indigo-600 text-white' : 'bg-[#141b26] border border-white/[0.1]'
              }`}>
                {isUser ? <User className="w-4 h-4" /> : agent.avatar}
              </div>

              {/* Message Bubble & Content */}
              <div className={`space-y-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                {/* Reasoning Thought Trace Accordion */}
                {!isUser && msg.thoughtProcess && msg.thoughtProcess.length > 0 && (
                  <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 text-xs text-slate-400">
                    <button
                      onClick={() => toggleThoughts(msg.id)}
                      className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-400 hover:text-indigo-300 w-full text-left"
                    >
                      {expandedThoughts[msg.id] ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <span>Thought Process ({msg.thoughtProcess.length} steps)</span>
                    </button>

                    {expandedThoughts[msg.id] && (
                      <ul className="mt-2 space-y-1 pl-4 border-l border-white/[0.08] text-[11px] text-slate-400 font-mono">
                        {msg.thoughtProcess.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span className="text-indigo-400">›</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Tool Invocations Card */}
                {!isUser && msg.toolCall && (
                  <div className="rounded-lg bg-[#0e1624] border border-blue-500/20 p-2.5 text-xs flex items-center gap-2 text-blue-300">
                    <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
                    <div>
                      <span className="font-mono text-[11px] text-blue-400">Tool: {msg.toolCall.toolName}</span>
                      {msg.toolCall.output && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{msg.toolCall.output}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Text Bubble */}
                <div className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                  isUser
                    ? 'bg-indigo-600 text-white rounded-br-none shadow-md shadow-indigo-900/20'
                    : 'bg-[#111722] border border-white/[0.08] text-slate-200 rounded-bl-none shadow-md'
                }`}>
                  {msg.content}
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

                <span className="text-[10px] text-slate-400 block px-1">
                  {msg.timestamp}
                </span>
              </div>
            </div>
          );
        })}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex gap-3 items-center text-xs text-slate-400">
            <div className="w-8 h-8 rounded-full bg-[#141b26] border border-white/[0.1] flex items-center justify-center">
              {agent.avatar}
            </div>
            <div className="flex items-center gap-2 bg-[#111722] border border-white/[0.08] px-3.5 py-2 rounded-xl">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
              <span>{agent.name} is thinking and coordinating tools...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Bar */}
      <div className="px-6 py-2 bg-[#090d15] border-t border-white/[0.05] flex items-center gap-2 overflow-x-auto scrollbar-none">
        <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider shrink-0 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-indigo-400" /> Actions:
        </span>
        {quickPrompts.map((p, idx) => {
          const Icon = p.icon;
          return (
            <button
              key={idx}
              onClick={() => onSendMessage(p.text)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.06] text-xs transition-colors shrink-0"
            >
              <Icon className="w-3 h-3 text-indigo-400" />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Message Input Bar */}
      <div className="p-4 bg-[#0c1017] border-t border-white/[0.08]">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
          <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-black/40 border border-white/[0.1] focus-within:border-indigo-500/60 focus-within:ring-1 focus-within:ring-indigo-500/40 transition-all">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Message ${agent.name} or ask them to browse, run commands, or draft pages...`}
              disabled={isLoading}
              className="bg-transparent border-none outline-none text-slate-100 placeholder:text-slate-500 w-full text-xs sm:text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="p-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
