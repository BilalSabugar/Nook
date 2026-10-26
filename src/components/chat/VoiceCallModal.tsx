'use client';

import React, { useState, useEffect, useRef } from 'react';
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
import { AgentArchetypeIcon } from '@/components/ui/ArchetypeIcon';

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
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [subtitle, setSubtitle] = useState<string>('Connecting audio session...');
  const [barHeights, setBarHeights] = useState<number[]>([20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20]);

  // Audio & Speech refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

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

  // Helper to speak agent audio via Web Speech Synthesis
  const speakAgentText = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSubtitle(`"${agent.name}: ${text}"`);
      return;
    }

    if (isSpeakerMuted) {
      setSubtitle(`"${agent.name}: ${text}"`);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.05;

    // Pick a natural English voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Alex')));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => {
      setAgentSpeaking(true);
      setSubtitle(`"${agent.name}: ${text}"`);
    };

    utterance.onend = () => {
      setAgentSpeaking(false);
      setSubtitle('"Listening... Speak anytime."');
    };

    utterance.onerror = () => {
      setAgentSpeaking(false);
      setSubtitle('"Listening... Speak anytime."');
    };

    window.speechSynthesis.speak(utterance);
  };

  // Mount effect: Start voice call with greeting and mic input
  useEffect(() => {
    if (!isOpen) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      return;
    }

    // Greet user
    const greeting = `Hello! I am ${agent.name}, your ${agent.role}. I am connected to your workspace and ready.`;
    const timer = setTimeout(() => {
      speakAgentText(greeting);
    }, 400);

    // Initialize Web Audio mic analyzer
    if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          micStreamRef.current = stream;
          const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          audioContextRef.current = audioCtx;
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyserRef.current = analyser;

          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateAudioBars = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);

            const bars: number[] = [];
            const step = Math.max(1, Math.floor(dataArray.length / 12));
            for (let i = 0; i < 12; i++) {
              const val = dataArray[i * step] || 0;
              const normalized = Math.min(100, Math.max(15, (val / 255) * 100));
              bars.push(normalized);
            }
            setBarHeights(bars);
            animFrameRef.current = requestAnimationFrame(updateAudioBars);
          };
          updateAudioBars();
        })
        .catch(() => {
          // Graceful fallback to synthetic wave
        });
    }

    // Initialize Web Speech Recognition
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recognition.onresult = (event: any) => {
            if (isMuted) return;
            let currentTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              currentTranscript += event.results[i][0].transcript;
            }
            if (currentTranscript.trim()) {
              setSubtitle(`You: "${currentTranscript.trim()}"`);
              // If user pauses or finishes a phrase
              const lastResult = event.results[event.results.length - 1];
              if (lastResult.isFinal) {
                const captured = currentTranscript.trim();
                setTimeout(() => {
                  speakAgentText(`Understood: ${captured}. I am coordinating with your computer.`);
                }, 700);
              }
            }
          };

          recognition.onerror = () => {
            // keep listening
          };

          recognition.start();
          recognitionRef.current = recognition;
        } catch {
          // recognition unavailable
        }
      }
    }

    return () => {
      clearTimeout(timer);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, [isOpen, agent.name, agent.role]);

  // Handle speaker mute change
  useEffect(() => {
    if (isSpeakerMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setAgentSpeaking(false);
    }
  }, [isSpeakerMuted]);

  // Simulated fluid wave fallback when no real mic stream is available
  useEffect(() => {
    if (!isOpen || micStreamRef.current) return;
    const interval = setInterval(() => {
      if (agentSpeaking) {
        setBarHeights([
          35 + Math.random() * 45,
          50 + Math.random() * 45,
          25 + Math.random() * 40,
          70 + Math.random() * 30,
          45 + Math.random() * 50,
          85 + Math.random() * 15,
          60 + Math.random() * 40,
          40 + Math.random() * 50,
          75 + Math.random() * 25,
          55 + Math.random() * 40,
          30 + Math.random() * 40,
          65 + Math.random() * 35,
        ]);
      } else {
        setBarHeights([20, 22, 18, 25, 20, 22, 18, 20, 22, 18, 24, 20]);
      }
    }, 150);
    return () => clearInterval(interval);
  }, [isOpen, agentSpeaking]);

  if (!isOpen) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Minimized Picture-in-Picture Mini-Player
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50 glass-card p-3 rounded-2xl shadow-2xl flex items-center gap-3 text-neutral-200 animate-slide-up border border-white/20">
        <div className="relative">
          <AgentArchetypeIcon name={agent.name} avatarKey={agent.avatar} size="md" />
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-[#141414]" />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white">{agent.name}</span>
            <span className="text-[10px] font-mono text-neutral-300 bg-white/[0.08] px-1.5 py-0.2 rounded border border-white/[0.1]">
              {formatTime(callDuration)}
            </span>
          </div>
          <p className="text-[10px] text-neutral-400">
            {agentSpeaking ? 'Speaking...' : 'Listening...'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              isMuted ? 'bg-white/20 text-white' : 'bg-white/[0.08] text-neutral-300 hover:text-white'
            }`}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setIsMinimized(false)}
            title="Expand Call View"
            className="p-1.5 rounded-lg bg-white/[0.08] text-neutral-300 hover:text-white transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onEndCall}
            title="End Call"
            className="p-1.5 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold transition-colors cursor-pointer"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Full Call Screen Overlay
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-2xl flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-3xl glass-card apple-fluid-glow p-8 shadow-2xl flex flex-col items-center justify-between min-h-[500px] text-neutral-200 relative overflow-hidden animate-scale-in border border-white/[0.14]">
        {/* Top Header */}
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-neutral-300 uppercase tracking-wider font-medium">
              Live Voice Session
            </span>
          </div>

          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Minimize to Picture-in-Picture"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Center Coworker Presence & Reactive Waveform */}
        <div className="flex flex-col items-center space-y-6 my-auto w-full">
          {/* Animated Glow Avatar */}
          <div className="relative">
            <div className={`absolute -inset-4 rounded-full bg-white/10 blur-xl transition-all duration-700 ${
              agentSpeaking ? 'scale-125 opacity-100' : 'scale-95 opacity-20'
            }`} />
            <AgentArchetypeIcon name={agent.name} avatarKey={agent.avatar} size="xl" />
          </div>

          <div className="text-center space-y-1">
            <h3 className="text-xl font-bold text-white tracking-tight">{agent.name}</h3>
            <p className="text-xs text-neutral-400">{agent.role}</p>
            <p className="text-sm font-mono text-neutral-300 font-medium pt-1">
              {formatTime(callDuration)}
            </p>
          </div>

          {/* Interactive Audio Visualizer Waves — 12 Reactive Bands */}
          <div className="flex items-center gap-1.5 h-14 px-6 py-2.5 glass-panel rounded-full border border-white/[0.1]">
            {barHeights.map((height, idx) => (
              <span
                key={idx}
                style={{
                  height: `${height}%`,
                  transition: 'height 0.1s ease-out',
                }}
                className={`w-1.5 rounded-full ${
                  agentSpeaking
                    ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                    : isMuted
                    ? 'bg-neutral-600'
                    : 'bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.4)]'
                }`}
              />
            ))}
          </div>

          {/* Real-time Subtitles / Live Captions */}
          <div className="w-full max-w-sm text-center px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
            <p className="text-xs text-neutral-200 italic leading-relaxed">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="flex items-center gap-4 pt-4 border-t border-white/[0.08] w-full justify-center">
          {/* Mute Mic */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isMuted
                ? 'bg-white/20 text-white border border-white/40 shadow-inner'
                : 'bg-white/[0.08] text-white hover:bg-white/[0.15] border border-white/[0.1]'
            }`}
            title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* End Call — Clean White Button */}
          <button
            onClick={onEndCall}
            className="w-12 h-12 rounded-full bg-white hover:bg-neutral-200 text-black flex items-center justify-center shadow-lg transition-all active:scale-95 cursor-pointer font-semibold"
            title="End Call"
          >
            <PhoneOff className="w-5 h-5" />
          </button>

          {/* Mute Speaker */}
          <button
            onClick={() => setIsSpeakerMuted(!isSpeakerMuted)}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isSpeakerMuted
                ? 'bg-white/20 text-white border border-white/40 shadow-inner'
                : 'bg-white/[0.08] text-white hover:bg-white/[0.15] border border-white/[0.1]'
            }`}
            title={isSpeakerMuted ? 'Unmute Speaker' : 'Mute Speaker'}
          >
            {isSpeakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};
