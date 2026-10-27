'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Target, 
  Play, 
  CheckCircle2, 
  ShieldCheck, 
  FileText, 
  Terminal, 
  Download, 
  RefreshCw, 
  Layers, 
  ChevronRight,
  ChevronDown,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { Agent } from '@/types';

interface MissionTask {
  id: string;
  missionId: string;
  agentId: string;
  title: string;
  goal: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  priority: 'low' | 'normal' | 'high' | 'critical';
  dependencies: string[];
  outputArtifacts?: string[];
  verificationStatus?: 'unverified' | 'verified' | 'failed';
  verificationDetails?: string;
  observations?: Array<{ timestamp: string; note: string; artifactRef?: string }>;
}

interface Mission {
  id: string;
  title: string;
  objective: string;
  status: 'planned' | 'in_progress' | 'completed' | 'failed' | 'paused' | 'cancelled';
  assignedCoworkers: string[];
  priority: 'low' | 'normal' | 'high' | 'critical';
  createdAt: string;
  updatedAt: string;
  tasks?: MissionTask[];
}

interface EvidenceRecord {
  id: string;
  missionId?: string;
  taskId?: string;
  agentId: string;
  actionType: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutputSummary?: string;
  commandExitCode?: number;
  filePath?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  verified: boolean;
  verificationMethod?: string;
  createdAt: string;
}

interface MissionDashboardProps {
  agents: Agent[];
  onSwitchToComputer?: () => void;
  onSwitchToSpaces?: () => void;
}

export const MissionDashboard: React.FC<MissionDashboardProps> = ({
  agents,
  onSwitchToComputer: _onSwitchToComputer,
  onSwitchToSpaces: _onSwitchToSpaces
}) => {
  const [activeTab, setActiveTab] = useState<'missions' | 'evidence'>('missions');
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTicking, setIsTicking] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});

  // Mission creation form state
  const [newTitle, setNewTitle] = useState('');
  const [newObjective, setNewObjective] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>(['agent-scout', 'agent-quill', 'agent-cipher']);
  const [codeExecutionAllowed, setCodeExecutionAllowed] = useState(true);
  const [isPlanning, setIsPlanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Fetch missions
  const fetchMissions = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/missions');
      if (res.ok) {
        const data = await res.json();
        setMissions(data.missions || []);
        if (!selectedMissionId && data.missions?.length > 0) {
          setSelectedMissionId(data.missions[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch missions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedMissionId]);

  // Fetch evidence records
  const fetchEvidence = useCallback(async (missionId?: string) => {
    try {
      const url = missionId 
        ? `/api/missions/evidence?missionId=${encodeURIComponent(missionId)}`
        : '/api/missions/evidence';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEvidenceList(data.evidence || []);
      }
    } catch (err) {
      console.error('Failed to fetch evidence:', err);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMissions();
    }, 10);
    return () => clearTimeout(timer);
  }, [fetchMissions]);

  useEffect(() => {
    if (activeTab === 'evidence') {
      const timer = setTimeout(() => {
        fetchEvidence(selectedMissionId || undefined);
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [activeTab, selectedMissionId, fetchEvidence]);

  const handlePlanMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newObjective.trim()) return;

    try {
      setIsPlanning(true);
      setStatusMessage('Aura is decomposing mission objective and assigning coworkers...');

      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'plan',
          title: newTitle.trim(),
          objective: newObjective.trim(),
          assignedCoworkers: selectedAgents,
          codeExecutionAllowed
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to plan mission');
      }

      const data = await res.json();
      setStatusMessage(`Mission planned successfully with ${data.tasks?.length || 0} coordinated tasks.`);
      setNewTitle('');
      setNewObjective('');
      await fetchMissions();
      if (data.mission?.id) {
        setSelectedMissionId(data.mission.id);
      }
    } catch (err: unknown) {
      const error = err as Error;
      setStatusMessage(`Planning failed: ${error.message}`);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleTickMission = async (missionId: string) => {
    try {
      setIsTicking(true);
      setStatusMessage('Advancing orchestrator tick across assigned coworkers...');

      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'tick',
          missionId
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to step mission');
      }

      const data = await res.json();
      setStatusMessage(data.message || 'Mission stepped successfully.');
      await fetchMissions();
      if (activeTab === 'evidence') {
        await fetchEvidence(missionId);
      }
    } catch (err: unknown) {
      const error = err as Error;
      setStatusMessage(`Execution error: ${error.message}`);
    } finally {
      setIsTicking(false);
    }
  };

  const handleExportAuditReport = async () => {
    try {
      const url = selectedMissionId
        ? `/api/missions/evidence?missionId=${encodeURIComponent(selectedMissionId)}&format=markdown`
        : '/api/missions/evidence?format=markdown';
      const res = await fetch(url);
      if (res.ok) {
        const markdown = await res.text();
        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = `nook-evidence-report-${selectedMissionId || 'all'}.md`;
        a.click();
        URL.revokeObjectURL(dlUrl);
      }
    } catch (err) {
      console.error('Failed to export audit report:', err);
    }
  };

  const handleExportWorkspace = async () => {
    try {
      const res = await fetch('/api/workspace/export');
      if (res.ok) {
        const exportData = await res.json();
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = `nook-sovereign-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(dlUrl);
      }
    } catch (err) {
      console.error('Failed to export sovereign workspace:', err);
    }
  };

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks(prev => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const selectedMission = missions.find(m => m.id === selectedMissionId) || missions[0];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0a0d] text-neutral-200 overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-white/[0.08] px-6 flex items-center justify-between bg-[#0e0e13]/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-white">Nook Missions & Evidence</h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                Aura Orchestrator
              </span>
            </div>
            <p className="text-[11px] text-neutral-400">Goal-directed autonomous execution with immutable verification records</p>
          </div>
        </div>

        {/* Tab & Actions Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#15151c] p-0.5 rounded-xl border border-white/[0.08]">
            <button
              onClick={() => setActiveTab('missions')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'missions'
                  ? 'bg-white/[0.1] text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Missions ({missions.length})
            </button>
            <button
              onClick={() => setActiveTab('evidence')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'evidence'
                  ? 'bg-white/[0.1] text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Evidence Engine
            </button>
          </div>

          <button
            onClick={fetchMissions}
            disabled={isLoading}
            title="Refresh Missions"
            className="p-1.5 rounded-lg border border-white/[0.08] bg-[#15151c] hover:bg-white/[0.05] text-neutral-400 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleExportAuditReport}
            title="Export Redacted Markdown Audit Trail"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.08] bg-[#15151c] hover:bg-white/[0.05] text-neutral-300 hover:text-white text-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-neutral-400" />
            Audit Report
          </button>

          <button
            onClick={handleExportWorkspace}
            title="Export Sovereign Zero-Cloud Workspace Backup"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Sovereign Backup
          </button>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div className="px-6 py-2 bg-purple-500/10 border-b border-purple-500/20 text-xs text-purple-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>{statusMessage}</span>
          </div>
          <button 
            onClick={() => setStatusMessage(null)}
            className="text-[10px] text-purple-400 hover:text-purple-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'missions' ? (
          <>
            {/* Left Column: Mission List & Creation */}
            <div className="w-80 border-r border-white/[0.08] bg-[#0c0c10] flex flex-col shrink-0">
              {/* Mission Creation Form */}
              <div className="p-4 border-b border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white tracking-wide uppercase font-mono">
                    Plan New Mission
                  </span>
                  <span className="text-[10px] text-neutral-500">Aura Decomposer</span>
                </div>

                <form onSubmit={handlePlanMission} className="space-y-2.5">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Robotic Control Frameworks"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#15151c] border border-white/[0.08] text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
                  />
                  <textarea
                    value={newObjective}
                    onChange={(e) => setNewObjective(e.target.value)}
                    rows={3}
                    placeholder="Describe high-level objective, deliverables, and test criteria..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#15151c] border border-white/[0.08] text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50 resize-none"
                  />

                  {/* Coworker selection */}
                  <div>
                    <label className="text-[10px] text-neutral-400 block mb-1">Assigned Coworkers:</label>
                    <div className="flex flex-wrap gap-1">
                      {agents.map(a => {
                        const isSelected = selectedAgents.includes(a.id);
                        return (
                          <button
                            type="button"
                            key={a.id}
                            onClick={() => {
                              setSelectedAgents(prev => 
                                isSelected ? prev.filter(id => id !== a.id) : [...prev, a.id]
                              );
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                              isSelected
                                ? 'bg-purple-500/20 border-purple-500/40 text-purple-200'
                                : 'bg-[#15151c] border-white/[0.06] text-neutral-500 hover:text-neutral-300'
                            }`}
                          >
                            {a.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-1.5 text-[11px] text-neutral-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={codeExecutionAllowed}
                        onChange={(e) => setCodeExecutionAllowed(e.target.checked)}
                        className="rounded border-white/[0.1] bg-[#15151c] text-purple-600 focus:ring-0"
                      />
                      <span>Sandbox Execution</span>
                    </label>

                    <button
                      type="submit"
                      disabled={isPlanning || !newTitle.trim() || !newObjective.trim()}
                      className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1 transition-all shadow-sm"
                    >
                      {isPlanning ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Planning...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3" />
                          <span>Decompose</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Missions list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-thin">
                <div className="px-1 text-[10px] font-mono uppercase text-neutral-500 mb-2">
                  Active & Past Objectives
                </div>

                {missions.length === 0 ? (
                  <div className="text-center py-8 text-neutral-500 text-xs">
                    No missions planned yet. Submit an objective above to get started.
                  </div>
                ) : (
                  missions.map((m) => {
                    const isSelected = selectedMission?.id === m.id;
                    const completedCount = m.tasks?.filter(t => t.status === 'completed').length || 0;
                    const totalCount = m.tasks?.length || 0;

                    return (
                      <button
                        key={m.id}
                        onClick={() => setSelectedMissionId(m.id)}
                        className={`w-full text-left p-2.5 rounded-xl border transition-all ${
                          isSelected
                            ? 'bg-white/[0.08] border-white/[0.15] text-white shadow-sm'
                            : 'bg-[#121217] border-white/[0.04] text-neutral-400 hover:text-white hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-xs truncate max-w-[170px] text-neutral-200">
                            {m.title}
                          </span>
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded capitalize ${
                            m.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : m.status === 'in_progress'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse'
                              : 'bg-white/[0.05] text-neutral-400 border border-white/[0.08]'
                          }`}>
                            {m.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-500 line-clamp-1 mb-2">
                          {m.objective}
                        </p>
                        <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono">
                          <span>{completedCount}/{totalCount} tasks</span>
                          <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Selected Mission Detail & Task Timeline */}
            <div className="flex-1 flex flex-col bg-[#0a0a0d] overflow-y-auto p-6 scrollbar-thin">
              {selectedMission ? (
                <div className="max-w-4xl w-full mx-auto space-y-6">
                  {/* Mission Summary Card */}
                  <div className="p-5 rounded-2xl bg-[#121217] border border-white/[0.08] shadow-lg relative overflow-hidden">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-lg font-semibold text-white tracking-tight">
                            {selectedMission.title}
                          </h2>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full capitalize ${
                            selectedMission.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : selectedMission.status === 'in_progress'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              : 'bg-white/[0.05] text-neutral-400 border border-white/[0.08]'
                          }`}>
                            {selectedMission.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-300 leading-relaxed">
                          {selectedMission.objective}
                        </p>
                      </div>

                      {/* Step / Advance Mission Button */}
                      <button
                        onClick={() => handleTickMission(selectedMission.id)}
                        disabled={isTicking || selectedMission.status === 'completed'}
                        className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-md shrink-0"
                      >
                        {isTicking ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Stepping...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Step Mission</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Progress Bar */}
                    {selectedMission.tasks && selectedMission.tasks.length > 0 && (
                      <div className="pt-2 border-t border-white/[0.06]">
                        <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1.5 font-mono">
                          <span>Milestone Completion</span>
                          <span>
                            {Math.round(
                              ((selectedMission.tasks.filter(t => t.status === 'completed').length) /
                                selectedMission.tasks.length) * 100
                            )}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-500"
                            style={{
                              width: `${(selectedMission.tasks.filter(t => t.status === 'completed').length / selectedMission.tasks.length) * 100}%`
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Coordinated Tasks Breakdown */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5" />
                        Coordinated Milestones & Delegation
                      </h3>
                      <span className="text-[11px] text-neutral-500">
                        {selectedMission.tasks?.length || 0} tasks tracked
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {selectedMission.tasks?.map((task, idx) => {
                        const isExpanded = !!expandedTasks[task.id];
                        const agent = agents.find(a => a.id === task.agentId);

                        return (
                          <div 
                            key={task.id}
                            className="rounded-xl border border-white/[0.08] bg-[#121217] overflow-hidden transition-all"
                          >
                            <div 
                              onClick={() => toggleTaskExpansion(task.id)}
                              className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-white/[0.02]"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="text-neutral-500 text-xs font-mono w-5">
                                  #{idx + 1}
                                </div>

                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-white truncate">
                                      {task.title}
                                    </span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-neutral-400 border border-white/[0.08]">
                                      {agent?.name || task.agentId}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                                    {task.goal}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                {task.verificationStatus === 'verified' && (
                                  <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                    <ShieldCheck className="w-3 h-3" />
                                    Verified
                                  </span>
                                )}

                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded capitalize ${
                                  task.status === 'completed'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : task.status === 'in_progress'
                                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                    : 'bg-white/[0.05] text-neutral-400 border border-white/[0.08]'
                                }`}>
                                  {task.status}
                                </span>

                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-neutral-500" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-neutral-500" />
                                )}
                              </div>
                            </div>

                            {/* Expanded Task Observations & Verification Details */}
                            {isExpanded && (
                              <div className="px-4 pb-4 pt-1 border-t border-white/[0.06] bg-black/20 space-y-3 text-xs">
                                {task.dependencies && task.dependencies.length > 0 && (
                                  <div>
                                    <span className="text-[10px] font-mono uppercase text-neutral-500 block mb-1">
                                      Depends On:
                                    </span>
                                    <div className="flex gap-1.5 flex-wrap">
                                      {task.dependencies.map(dep => (
                                        <span key={dep} className="px-1.5 py-0.5 rounded bg-white/[0.04] text-[10px] font-mono text-neutral-400 border border-white/[0.06]">
                                          {dep}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {task.outputArtifacts && task.outputArtifacts.length > 0 && (
                                  <div>
                                    <span className="text-[10px] font-mono uppercase text-neutral-500 block mb-1">
                                      Output Artifacts:
                                    </span>
                                    <div className="flex gap-1.5 flex-wrap">
                                      {task.outputArtifacts.map(art => (
                                        <span key={art} className="px-1.5 py-0.5 rounded bg-purple-500/10 text-[10px] font-mono text-purple-300 border border-purple-500/20 flex items-center gap-1">
                                          <FileText className="w-3 h-3" />
                                          {art}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {task.verificationDetails && (
                                  <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-emerald-300">
                                    <span className="text-[10px] font-mono uppercase text-emerald-400 block mb-0.5 flex items-center gap-1">
                                      <ShieldCheck className="w-3 h-3" />
                                      Verification Proof:
                                    </span>
                                    <p className="text-[11px] font-mono">{task.verificationDetails}</p>
                                  </div>
                                )}

                                {task.observations && task.observations.length > 0 && (
                                  <div>
                                    <span className="text-[10px] font-mono uppercase text-neutral-500 block mb-1">
                                      Observations Log:
                                    </span>
                                    <div className="space-y-1">
                                      {task.observations.map((obs, oIdx) => (
                                        <div key={oIdx} className="p-2 rounded bg-white/[0.03] border border-white/[0.04] text-[11px] text-neutral-300 flex items-start justify-between">
                                          <span>{obs.note}</span>
                                          <span className="text-[10px] font-mono text-neutral-500 shrink-0 ml-2">
                                            {new Date(obs.timestamp).toLocaleTimeString()}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-neutral-500 text-xs">
                  Select a mission to inspect its coordination plan.
                </div>
              )}
            </div>
          </>
        ) : (
          /* EVIDENCE TAB: Inspection of real tool calls, citations, exits, diffs */
          <div className="flex-1 flex flex-col bg-[#0a0a0d] overflow-y-auto p-6 scrollbar-thin">
            <div className="max-w-4xl w-full mx-auto space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <div>
                  <h2 className="text-sm font-semibold text-white">Immutable Evidence Records</h2>
                  <p className="text-xs text-neutral-400">Verifiable trace of tool calls, source citations, exit codes, and diffs</p>
                </div>
                <span className="text-xs font-mono text-neutral-500">
                  {evidenceList.length} total verifiable records
                </span>
              </div>

              {evidenceList.length === 0 ? (
                <div className="text-center py-16 text-neutral-500 text-xs">
                  No evidence records registered yet. Advance a mission to generate verifiable records.
                </div>
              ) : (
                <div className="space-y-3">
                  {evidenceList.map((rec) => {
                    return (
                      <div 
                        key={rec.id}
                        className="p-4 rounded-xl bg-[#121217] border border-white/[0.08] shadow-sm space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 capitalize">
                              {rec.actionType.replace('_', ' ')}
                            </span>
                            <span className="text-xs font-medium text-white">
                              {rec.toolName || rec.actionType}
                            </span>
                            <span className="text-[10px] text-neutral-400 font-mono">
                              by {rec.agentId}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {rec.verified && (
                              <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3" />
                                Verified
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-neutral-500">
                              {new Date(rec.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>

                        {rec.sourceUrl && (
                          <div className="flex items-center gap-1.5 text-xs text-blue-400 font-mono">
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <a href={rec.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
                              {rec.sourceTitle || rec.sourceUrl}
                            </a>
                          </div>
                        )}

                        {rec.commandExitCode !== undefined && (
                          <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                            <Terminal className="w-3 h-3 text-neutral-500" />
                            <span>Exit Code:</span>
                            <span className={rec.commandExitCode === 0 ? 'text-emerald-400' : 'text-red-400'}>
                              {rec.commandExitCode}
                            </span>
                          </div>
                        )}

                        {rec.filePath && (
                          <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                            <FileText className="w-3 h-3 text-neutral-500" />
                            <span className="truncate">{rec.filePath}</span>
                          </div>
                        )}

                        {rec.toolOutputSummary && (
                          <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.04] text-[11px] font-mono text-neutral-300 leading-relaxed overflow-x-auto">
                            {rec.toolOutputSummary}
                          </div>
                        )}

                        {rec.verificationMethod && (
                          <div className="text-[10px] font-mono text-neutral-500">
                            Verification Method: <span className="text-neutral-400">{rec.verificationMethod}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
