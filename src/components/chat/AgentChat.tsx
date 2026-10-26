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
import { RichMarkdown } from '@/components/ui/RichMarkdown';
import { AgentArchetypeIcon } from '@/components/ui/ArchetypeIcon';

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
    <div className="flex-1 flex flex-col h-screen bg-[#09090b] text-neutral-200 overflow-hidden relative">
      {/* Header Bar — Minimalist glassmorphic header */}
      <div className="h-14 px-6 border-b border-white/[0.08] glass-panel flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <AgentArchetypeIcon name={agent.name} avatarKey={agent.avatar} size="lg" />
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-[#09090b]" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white text-sm tracking-tight">{agent.name}</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-neutral-300 border border-white/[0.08]">
                {agent.role}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-none mt-0.5">
              {agent.statusMessage || 'Always-on coworker'}
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCallModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 hover:text-white border border-white/[0.08] hover:border-white/20 text-xs font-medium transition-all duration-200 hover:-translate-y-0.5 active:scale-95 active:translate-y-0 shadow-sm"
          >
            <Phone className="w-3.5 h-3.5 text-neutral-300" />
            <span>Call</span>
          </button>

          {agent.computerEnabled && (
            <button
              onClick={onSwitchToComputer}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 hover:text-white border border-white/[0.08] hover:border-white/20 text-xs font-medium transition-all duration-200 hover:-translate-y-0.5 active:scale-95 active:translate-y-0 shadow-sm"
            >
              <Monitor className="w-3.5 h-3.5 text-neutral-300" />
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
              className={`flex gap-3 max-w-3xl group animate-slide-up ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
            >
              {/* Avatar Icon */}
              {isUser ? (
                <div className="w-8 h-8 rounded-lg bg-white text-black font-semibold flex items-center justify-center shrink-0 text-xs shadow-md">
                  U
                </div>
              ) : (
                <AgentArchetypeIcon name={agent.name} avatarKey={agent.avatar} size="lg" />
              )}

              {/* Message Bubble & Content */}
              <div className={`space-y-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                {/* Reasoning Thought Trace Accordion */}
                {!isUser && msg.thoughtProcess && msg.thoughtProcess.length > 0 && (
                  <div className="rounded-xl glass-card p-3 text-xs text-neutral-400">
                    <button
                      onClick={() => toggleThoughts(msg.id)}
                      className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-300 hover:text-white w-full text-left transition-colors"
                    >
                      {expandedThoughts[msg.id] ? (
                        <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                      )}
                      <span>Reasoning ({msg.thoughtProcess.length} steps)</span>
                    </button>

                    {expandedThoughts[msg.id] && (
                      <ul className="mt-2 space-y-1 pl-3 border-l border-white/[0.1] text-[11px] text-neutral-400 font-mono animate-fade-in">
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
                  <div className="rounded-lg bg-[#141414] border border-white/[0.08] p-2.5 text-xs flex items-center gap-2.5 text-neutral-300 animate-fade-in">
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

                {/* Text Bubble with Rich Markdown Formatting */}
                <div className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed relative transition-all ${
                  isUser
                    ? 'bg-[#27272a] text-white border border-white/[0.1] rounded-tr-sm shadow-md'
                    : 'glass-card text-neutral-200 rounded-tl-sm shadow-md'
                }`}>
                  <RichMarkdown content={msg.content} />

                  {/* Copy button on hover */}
                  <button
                    onClick={() => copyMessage(msg.id, msg.content)}
                    className="absolute -bottom-2 -right-2 p-1 rounded-md bg-[#1f1f24] border border-white/[0.12] text-neutral-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
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

                <div className="flex items-center gap-2 px-1 text-[10px] text-neutral-500 font-mono">
                  <span>{msg.timestamp}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Signature ChatGPT & OpenDots Thinking Dots */}
        {isLoading && (
          <div className="flex gap-3 items-center text-xs text-neutral-400 mr-auto py-1 animate-fade-in">
            <AgentArchetypeIcon name={agent.name} avatarKey={agent.avatar} size="lg" />
            <div className="flex items-center gap-2.5 glass-card px-4 py-2.5 rounded-xl border border-white/[0.1]">
              <div className="flex items-center gap-1.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white chatgpt-dot-1" />
                <span className="w-1.5 h-1.5 rounded-full bg-white chatgpt-dot-2" />
                <span className="w-1.5 h-1.5 rounded-full bg-white chatgpt-dot-3" />
              </div>
              <span className="text-neutral-300 text-xs font-mono font-medium">{agent.name} is thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Bar */}
      <div className="px-6 py-2.5 bg-[#09090b]/80 border-t border-white/[0.06] backdrop-blur-md flex items-center gap-2 overflow-x-auto scrollbar-none">
        <span className="text-[11px] text-neutral-400 font-medium tracking-wide uppercase shrink-0 flex items-center gap-1 font-mono">
          <Command className="w-3 h-3" /> Focus:
        </span>
        {quickPrompts.map((p, idx) => {
          const Icon = p.icon;
          return (
            <button
              key={idx}
              onClick={() => onSendMessage(p.text)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full glass-card hover:bg-white/[0.08] hover:border-white/20 text-neutral-300 hover:text-white border border-white/[0.08] text-xs transition-all duration-200 shrink-0 hover:-translate-y-0.5 active:scale-95 shadow-sm"
            >
              <Icon className="w-3 h-3 text-neutral-400" />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      {/* Message Input Bar — Apple Intelligence-style glass capsule */}
      <div className="p-4 bg-[#09090b] border-t border-white/[0.08]">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-3xl mx-auto">
          <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl glass-input apple-active-capsule transition-all">
            <span className="text-neutral-400 text-xs flex items-center gap-1 font-mono">
              <AtSign className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Message ${agent.name} or type @Agent to collaborate...`}
              disabled={isLoading}
              className="bg-transparent border-none outline-none text-white placeholder:text-neutral-500 w-full text-xs sm:text-sm font-sans"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isLoading}
              className="w-7 h-7 rounded-full bg-white hover:bg-neutral-200 disabled:opacity-20 disabled:bg-neutral-800 disabled:text-neutral-500 text-black font-semibold transition-all flex items-center justify-center shrink-0 shadow-md active:scale-90"
              title="Send message"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
