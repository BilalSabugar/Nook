import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import {
  listMissions,
  getMissionById,
  updateMissionStatus,
  listTasksForMission,
  listEvidence,
  acquireWorkerLease,
  releaseWorkerLease,
  scrubSensitiveData,
} from '@/lib/db';
import { planMission, tickMission } from '@/lib/orchestrator';

/**
 * GET /api/missions
 * Lists persistent missions or returns full mission details including tasks and evidence.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const { searchParams } = new URL(req.url);
  const missionId = searchParams.get('id');

  if (missionId) {
    const mission = getMissionById(missionId);
    if (!mission) {
      return NextResponse.json({ error: `Mission ${missionId} not found` }, { status: 404 });
    }

    const tasks = listTasksForMission(missionId);
    const evidence = listEvidence({ missionId });

    return NextResponse.json(scrubSensitiveData({
      mission: {
        ...mission,
        tasks,
        evidenceTimeline: evidence,
      },
    }));
  }

  const missions = listMissions();
  return NextResponse.json(scrubSensitiveData({
    missions,
    total: missions.length,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * POST /api/missions
 * Manages mission lifecycle:
 * - action="plan": Aura decomposes goal into structured tasks
 * - action="tick": Advances mission execution by running the next eligible task
 * - action="pause" / "resume" / "cancel": Modifies execution state
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { action, title, objective, priority, requiresCodeExecution, codeGenerationMode, modelOptions, missionId } = body;

    // 1. Aura plans a new mission
    if (action === 'plan' || !action) {
      if (!objective) {
        return NextResponse.json({ error: 'Mission objective is required' }, { status: 400 });
      }

      // Strip any API keys or credentials from modelOptions before planning
      const safeModelOptions = modelOptions ? {
        provider: modelOptions.provider,
        model: modelOptions.model,
        endpoint: modelOptions.endpoint,
      } : undefined;

      const mission = planMission({
        title: title || 'Autonomous Multi-Agent Mission',
        objective,
        priority: priority || 'medium',
        requiresCodeExecution: Boolean(requiresCodeExecution),
        codeGenerationMode: codeGenerationMode || 'auto',
        modelOptions: safeModelOptions,
      });

      return NextResponse.json(scrubSensitiveData({
        success: true,
        mission,
      }), { status: 201 });
    }

    // 2. Tick / step mission execution
    if (action === 'tick' && missionId) {
      const actorId = `api-req-${Date.now()}`;
      const updated = await tickMission(missionId, actorId);
      if (updated.leaseBusy) {
        return NextResponse.json({
          error: 'Mission execution lease is currently held by a background worker or another active process. Retry shortly.',
          leaseBusy: true,
        }, { status: 409 });
      }

      const tasks = listTasksForMission(missionId);
      const evidence = listEvidence({ missionId });

      return NextResponse.json(scrubSensitiveData({
        success: true,
        mission: {
          ...updated,
          tasks,
          evidenceTimeline: evidence,
        },
      }));
    }

    // 3. Pause mission (coordinates with active worker lease)
    if (action === 'pause' && missionId) {
      const actorId = `api-ctrl-${Date.now()}`;
      const lease = acquireWorkerLease(`mission:${missionId}`, actorId, 5000);
      if (!lease.acquired) {
        return NextResponse.json({
          error: `Mission is actively executing under worker lease (${lease.ownerId}). Wait or retry shortly.`,
          leaseBusy: true,
        }, { status: 409 });
      }
      try {
        updateMissionStatus(missionId, 'paused');
      } finally {
        releaseWorkerLease(`mission:${missionId}`, actorId);
      }
      const updated = getMissionById(missionId);
      return NextResponse.json({ success: true, mission: updated });
    }

    // 4. Resume mission (coordinates with active worker lease)
    if (action === 'resume' && missionId) {
      const actorId = `api-ctrl-${Date.now()}`;
      const lease = acquireWorkerLease(`mission:${missionId}`, actorId, 5000);
      if (!lease.acquired) {
        return NextResponse.json({
          error: `Mission lease is currently busy (${lease.ownerId}). Wait or retry shortly.`,
          leaseBusy: true,
        }, { status: 409 });
      }
      try {
        updateMissionStatus(missionId, 'active');
      } finally {
        releaseWorkerLease(`mission:${missionId}`, actorId);
      }
      const updated = getMissionById(missionId);
      return NextResponse.json({ success: true, mission: updated });
    }

    // 5. Cancel mission (coordinates with active worker lease)
    if (action === 'cancel' && missionId) {
      const actorId = `api-ctrl-${Date.now()}`;
      const lease = acquireWorkerLease(`mission:${missionId}`, actorId, 5000);
      if (!lease.acquired) {
        return NextResponse.json({
          error: `Mission is actively executing under worker lease (${lease.ownerId}). Wait or retry shortly.`,
          leaseBusy: true,
        }, { status: 409 });
      }
      try {
        updateMissionStatus(missionId, 'cancelled');
      } finally {
        releaseWorkerLease(`mission:${missionId}`, actorId);
      }
      const updated = getMissionById(missionId);
      return NextResponse.json({ success: true, mission: updated });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message || 'Mission error' }, { status: 500 });
  }
}
