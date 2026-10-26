'use client';

import React, { useState, useEffect } from 'react';
import { Agent } from '@/types';
import { 
  PhoneOff, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Minimize2, 
  Maximize2, 
  Sparkles,
  Waves
} from 'lucide-react';

interface VoiceCallModalProps {
  isOpen: boolean;
  agent: Agent;
  onEndCall: () => void;
}

export const VoiceCallModal: React.FC<VoiceCallModalProps> = ({
  isOpen,
  agent,
  onEndCall,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(true);

  // Call timer effect
  useEffect(() => {
    if (!isOpen) {
      setCallDuration(0);
      return;
    }
    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Simulated speech cadence
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setAgentSpeaking((prev) => !prev);
    }, 4000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Minimized Picture-in-Picture Mini-Player
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50 bg-[#0e1422] border border-white/[0.15] p-3 rounded-2xl shadow-2xl flex items-center gap-3 text-slate-200 ring-1 ring-emerald-500/30 animate-in fade-in slide-in-from-bottom-4">
        <div className="relative">
          <span className="text-xl">{agent.avatar}</span>
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-[#0e1422] animate-pulse" />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white">{agent.name}</span>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
              {formatTime(callDuration)}
            </span>
          </div>
          <p className="text-[10px] text-slate-400">
            {agentSpeaking ? 'Speaking...' : 'Listening to you'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-1.5 rounded-lg text-xs transition-colors ${
              isMuted ? 'bg-rose-500/20 text-rose-300' : 'bg-white/[0.08] text-slate-300 hover:text-white'
            }`}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setIsMinimized(false)}
            title="Expand Call View"
            className="p-1.5 rounded-lg bg-white/[0.08] text-slate-300 hover:text-white transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onEndCall}
            title="End Call"
            className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Full Call Screen Overlay
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-3xl bg-[#0b1019] border border-white/[0.12] p-8 shadow-2xl flex flex-col items-center justify-between min-h-[500px] text-slate-200 relative overflow-hidden">
        {/* Top Header */}
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider font-semibold">
              Live Voice Call
            </span>
          </div>

          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            title="Minimize to Picture-in-Picture"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Center Coworker Presence & Waveform */}
        <div className="flex flex-col items-center space-y-6 my-auto">
          {/* Animated Glow Avatar */}
          <div className="relative">
            <div className={`absolute -inset-4 rounded-full bg-indigo-500/20 blur-xl transition-all duration-700 ${
              agentSpeaking ? 'scale-125 opacity-100' : 'scale-95 opacity-30'
            }`} />
            <div className="w-28 h-28 rounded-full bg-[#131b28] border-2 border-white/[0.15] flex items-center justify-center text-5xl shadow-2xl relative z-10">
              {agent.avatar}
            </div>
          </div>

          <div className="text-center space-y-1">
            <h3 className="text-xl font-bold text-white tracking-tight">{agent.name}</h3>
            <p className="text-xs text-slate-400">{agent.role}</p>
            <p className="text-sm font-mono text-indigo-400 font-semibold pt-1">
              {formatTime(callDuration)}
            </p>
          </div>

          {/* Interactive Audio Visualizer Waves */}
          <div className="flex items-center gap-1.5 h-12 px-4 py-2 bg-black/40 rounded-2xl border border-white/[0.08]">
            {[40, 65, 30, 85, 55, 95, 70, 45, 90, 60, 35, 75].map((height, idx) => (
              <span
                key={idx}
                style={{
                  height: agentSpeaking ? `${height}%` : '20%',
                  transition: 'height 0.2s ease-in-out',
                }}
                className={`w-1 rounded-full ${
                  agentSpeaking ? 'bg-indigo-400' : 'bg-slate-600'
                }`}
              />
            ))}
          </div>

          {/* Real-time Subtitles / Live Captions */}
          <div className="max-w-xs text-center px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-xs text-slate-300 italic">
              {agentSpeaking
                ? `"${agent.name}: I have synchronized your recent Space documents and my computer is ready."`
                : '"Listening for your voice input..."'}
            </p>
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="flex items-center gap-4 pt-4 border-t border-white/[0.08] w-full justify-center">
          {/* Mute Mic */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              isMuted
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'bg-white/[0.08] text-white hover:bg-white/[0.15] border border-white/[0.1]'
            }`}
            title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* End Call */}
          <button
            onClick={onEndCall}
            className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-900/40 hover:scale-105 active:scale-95 transition-all"
            title="End Call"
          >
            <PhoneOff className="w-6 h-6" />
          </button>

          {/* Mute Speaker */}
          <button
            onClick={() => setIsSpeakerMuted(!isSpeakerMuted)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              isSpeakerMuted
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-white/[0.08] text-white hover:bg-white/[0.15] border border-white/[0.1]'
            }`}
            title={isSpeakerMuted ? 'Unmute Speaker' : 'Mute Speaker'}
          >
            {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
