'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Agent, Message, ReviewRequest } from '@/types';
import { ReviewCard } from '@/components/review/ReviewCard';
import { 
  ArrowUp, 
  Terminal, 
  Globe, 
  FilePlus, 
  ChevronDown, 
  ChevronRight, 
  Monitor, 
  Phone,
  Copy,
  Check,
  AtSign,
  Sparkles,
  Command
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

  // Minimalist Quick Action Prompts
  const quickPrompts = [
    { label: 'Browse OpenDots Repo', text: 'Browse https://github.com/CopilotKit/OpenDots and inspect its architecture', icon: Globe },
    { label: 'Draft Launch Brief', text: 'Draft a comprehensive Launch Brief for our Spaces and request my review', icon: FilePlus },
    { label: 'Run Sandbox Command', text: 'Run npm test in your container sandbox and show me the output', icon: Terminal },
    { label: 'Summarize Workspace', text: 'Review all living spaces and summarize our current engineering roadmap', icon: Sparkles },
  ];

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#0d0d0d] text-neutral-200 overflow-hidden relative">
      {/* Header Bar — Minimalist monochrome */}
      <div className="h-14 px-6 border-b border-white/[0.08] bg-[#0d0d0d] flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-lg bg-[#171717] border border-white/[0.08] flex items-center justify-center text-base">
              {agent.avatar}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-[#0d0d0d]" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white text-sm tracking-tight">{agent.name}</h2>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-neutral-400 border border-white/[0.08]">
                {agent.role}
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 leading-none mt-0.5">
              {agent.statusMessage || 'Always-on coworker'}
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCallModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 hover:text-white border border-white/[0.08] text-xs font-medium transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>Call</span>
          </button>

          {agent.computerEnabled && (
            <button
              onClick={onSwitchToComputer}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 hover:text-white border border-white/[0.08] text-xs font-medium transition-colors"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Computer</span>
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
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 space-y-6 scrollbar-thin">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-3xl group ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
            >
              {/* Avatar Icon */}
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs ${
                isUser 
                  ? 'bg-white text-black font-semibold' 
                  : 'bg-[#171717] border border-white/[0.08] text-sm'
              }`}>
                {isUser ? 'U' : agent.avatar}
              </div>

              {/* Message Bubble & Content */}
              <div className={`space-y-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                {/* Reasoning Thought Trace Accordion */}
                {!isUser && msg.thoughtProcess && msg.thoughtProcess.length > 0 && (
                  <div className="rounded-lg bg-[#141414] border border-white/[0.08] p-2.5 text-xs text-neutral-400">
                    <button
                      onClick={() => toggleThoughts(msg.id)}
                      className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-300 hover:text-white w-full text-left"
                    >
                      {expandedThoughts[msg.id] ? (
                        <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                      )}
                      <span>Reasoning ({msg.thoughtProcess.length} steps)</span>
                    </button>

                    {expandedThoughts[msg.id] && (
                      <ul className="mt-2 space-y-1 pl-3 border-l border-white/[0.1] text-[11px] text-neutral-400 font-mono">
                        {msg.thoughtProcess.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span className="text-neutral-500 font-bold">{idx + 1}.</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Tool Invocations Card */}
                {!isUser && msg.toolCall && (
                  <div className="rounded-lg bg-[#141414] border border-white/[0.08] p-2.5 text-xs flex items-center gap-2.5 text-neutral-300">
                    <div className="w-6 h-6 rounded bg-white/[0.06] flex items-center justify-center shrink-0">
                      <Terminal className="w-3.5 h-3.5 text-neutral-400" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] text-neutral-200">tool/{msg.toolCall.toolName}</span>
                      {msg.toolCall.output && (
                        <p className="text-[10px] text-neutral-500 mt-0.5 truncate font-mono">{msg.toolCall.output}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Text Bubble */}
                <div className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap relative ${
                  isUser
                    ? 'bg-[#27272a] text-white border border-white/[0.08] rounded-tr-sm shadow-sm'
                    : 'bg-[#141414] border border-white/[0.08] text-neutral-200 rounded-tl-sm shadow-sm'
                }`}>
                  {msg.content}

                  {/* Copy button on hover */}
                  <button
                    onClick={() => copyMessage(msg.id, msg.content)}
                    className="absolute -bottom-2 -right-2 p-1 rounded-md bg-[#1f1f1f] border border-white/[0.1] text-neutral-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    title="Copy message"
                  >
                    {copiedMessageId === msg.id ? (
                      <Check className="w-3 h-3 text-white" />
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

                <div className="flex items-center gap-2 px-1 text-[10px] text-neutral-500">
                  <span>{msg.timestamp}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Signature ChatGPT & OpenDots Thinking Dots */}
        {isLoading && (
          <div className="flex gap-3 items-center text-xs text-neutral-400 mr-auto py-1">
            <div className="w-7 h-7 rounded-lg bg-[#171717] border border-white/[0.08] flex items-center justify-center text-sm">
              {agent.avatar}
            </div>
            <div className="flex items-center gap-2.5 bg-[#141414] border border-white/[0.08] px-3.5 py-2 rounded-xl">
              <div className="flex items-center gap-1.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white chatgpt-dot-1" />
                <span className="w-1.5 h-1.5 rounded-full bg-white chatgpt-dot-2" />
                <span className="w-1.5 h-1.5 rounded-full bg-white chatgpt-dot-3" />
              </div>
              <span className="text-neutral-400 text-xs font-mono">{agent.name} is thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Bar */}
      <div className="px-6 py-2 bg-[#0d0d0d] border-t border-white/[0.05] flex items-center gap-2 overflow-x-auto scrollbar-none">
        <span className="text-[11px] text-neutral-500 font-medium uppercase tracking-wider shrink-0 flex items-center gap-1">
          <Command className="w-3 h-3" /> Suggestions:
        </span>
        {quickPrompts.map((p, idx) => {
          const Icon = p.icon;
          return (
            <button
              key={idx}
              onClick={() => onSendMessage(p.text)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#141414] hover:bg-white/[0.08] text-neutral-400 hover:text-white border border-white/[0.08] text-xs transition-colors shrink-0"
            >
              <Icon className="w-3 h-3 text-neutral-400" />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Message Input Bar — Signature ChatGPT capsule */}
      <div className="p-4 bg-[#0d0d0d] border-t border-white/[0.08]">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-3xl mx-auto">
          <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-[#171717] border border-white/[0.1] focus-within:border-white/30 transition-colors">
            <span className="text-neutral-500 text-xs flex items-center gap-1 font-mono">
              <AtSign className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Message ${agent.name} or type @Agent to collaborate...`}
              disabled={isLoading}
              className="bg-transparent border-none outline-none text-white placeholder:text-neutral-500 w-full text-xs sm:text-sm"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isLoading}
              className="w-7 h-7 rounded-full bg-white hover:bg-neutral-200 disabled:opacity-20 disabled:bg-neutral-800 disabled:text-neutral-500 text-black font-semibold transition-all flex items-center justify-center shrink-0"
              title="Send message"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
