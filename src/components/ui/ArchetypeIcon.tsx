'use client';

import React from 'react';
import { 
  Compass, 
  PenTool, 
  Cpu, 
  Sparkles, 
  Crown, 
  Terminal, 
  FolderKanban, 
  Layers, 
  Search, 
  BookOpen, 
  FileText, 
  FileCode,
  Rocket,
  Palette,
  BarChart3,
  Plug,
  Bot
} from 'lucide-react';

interface ArchetypeIconProps {
  name?: string;
  avatarKey?: string;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showAura?: boolean;
}

export const AgentArchetypeIcon: React.FC<ArchetypeIconProps> = ({
  name = '',
  avatarKey = '',
  className = '',
  size = 'md',
  showAura = false,
}) => {
  const normalizedKey = (avatarKey || '').toLowerCase();
  const normalizedName = (name || '').toLowerCase();

  // Size mappings
  const sizeClasses = {
    xs: 'w-5 h-5 text-xs',
    sm: 'w-6 h-6 text-xs',
    md: 'w-7 h-7 text-sm',
    lg: 'w-8 h-8 text-base',
    xl: 'w-20 h-20 text-3xl',
  };

  const iconSizes = {
    xs: 'w-3 h-3',
    sm: 'w-3.5 h-3.5',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
    xl: 'w-10 h-10',
  };

  // Determine archetype based on key or name
  if (normalizedKey === 'compass' || normalizedName.includes('scout') || normalizedKey.includes('🧭')) {
    return (
      <div
        className={`rounded-lg flex items-center justify-center shrink-0 border border-violet-500/25 bg-violet-500/10 text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.18)] ${sizeClasses[size]} ${className}`}
        title="Scout: Research & Intelligence"
      >
        <Compass className={`${iconSizes[size]} text-violet-300`} />
      </div>
    );
  }

  if (normalizedKey === 'pen-tool' || normalizedKey === 'quill' || normalizedName.includes('quill') || normalizedKey.includes('✍')) {
    return (
      <div
        className={`rounded-lg flex items-center justify-center shrink-0 border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.18)] ${sizeClasses[size]} ${className}`}
        title="Quill: Technical Writer"
      >
        <PenTool className={`${iconSizes[size]} text-emerald-300`} />
      </div>
    );
  }

  if (normalizedKey === 'cpu' || normalizedKey === 'terminal' || normalizedName.includes('cipher') || normalizedKey.includes('⚡')) {
    return (
      <div
        className={`rounded-lg flex items-center justify-center shrink-0 border border-amber-500/25 bg-amber-500/10 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.18)] ${sizeClasses[size]} ${className}`}
        title="Cipher: DevOps & Engineer"
      >
        <Terminal className={`${iconSizes[size]} text-amber-300`} />
      </div>
    );
  }

  if (normalizedKey === 'sparkles' || normalizedKey === 'crown' || normalizedName.includes('aura') || normalizedKey.includes('👑')) {
    return (
      <div
        className={`rounded-lg flex items-center justify-center shrink-0 border border-rose-500/25 bg-rose-500/10 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.18)] ${sizeClasses[size]} ${className}`}
        title="Aura: Executive Strategist"
      >
        <Sparkles className={`${iconSizes[size]} text-rose-300`} />
      </div>
    );
  }

  // Fallback for custom agents: sleek geometric monogram with white luminescence
  const initials = name ? name.slice(0, 2).toUpperCase() : 'AG';
  return (
    <div
      className={`rounded-lg flex items-center justify-center shrink-0 border border-white/[0.12] bg-[#17171a] text-white font-mono font-medium shadow-sm ${sizeClasses[size]} ${className}`}
    >
      <span className="text-[10px] tracking-tight">{initials}</span>
    </div>
  );
};

export const SpaceArchetypeIcon: React.FC<{ iconKey?: string; name?: string; className?: string }> = ({
  iconKey = '',
  name = '',
  className = '',
}) => {
  const key = (iconKey || '').toLowerCase();
  const n = (name || '').toLowerCase();

  const iconClass = `w-4 h-4 shrink-0 ${className || 'text-neutral-300'}`;

  if (key === 'layers' || key === 'rocket' || n.includes('launch') || n.includes('product') || key.includes('🚀')) {
    return <Layers className={iconClass} />;
  }
  if (key === 'search' || key === 'compass' || key === 'microscope' || n.includes('research') || n.includes('knowledge') || key.includes('🔬')) {
    return <Compass className={iconClass} />;
  }
  if (key === 'cpu' || key === 'terminal' || n.includes('engineering') || n.includes('devops') || key.includes('⚡')) {
    return <Cpu className={iconClass} />;
  }
  if (key === 'palette' || key.includes('🎨')) {
    return <Palette className={iconClass} />;
  }
  if (key === 'bar-chart' || key.includes('📊')) {
    return <BarChart3 className={iconClass} />;
  }
  if (key === 'plug' || key.includes('🔌')) {
    return <Plug className={iconClass} />;
  }
  if (key === 'file-text' || key.includes('📄') || key.includes('🏠')) {
    return <FileText className={iconClass} />;
  }

  return <FolderKanban className={iconClass} />;
};
