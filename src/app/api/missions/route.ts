import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import {
  listMissions,
  getMissionById,
  updateMissionStatus,
  listTasksForMission,
  listEvidence,
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

    return NextResponse.json({
      mission: {
        ...mission,
        tasks,
        evidenceTimeline: evidence,
      },
    });
  }

  const missions = listMissions();
  return NextResponse.json({
    missions,
    total: missions.length,
    timestamp: new Date().toISOString(),
  });
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
    const { action, title, objective, priority, requiresCodeExecution, missionId } = body;

    // 1. Aura plans a new mission
    if (action === 'plan' || !action) {
      if (!objective) {
        return NextResponse.json({ error: 'Mission objective is required' }, { status: 400 });
      }

      const mission = planMission({
        title: title || 'Autonomous Multi-Agent Mission',
        objective,
        priority: priority || 'medium',
        requiresCodeExecution: Boolean(requiresCodeExecution),
      });

      return NextResponse.json({
        success: true,
        mission,
      }, { status: 201 });
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

      return NextResponse.json({
        success: true,
        mission: {
          ...updated,
          tasks,
          evidenceTimeline: evidence,
        },
      });
    }

    // 3. Pause mission
    if (action === 'pause' && missionId) {
      updateMissionStatus(missionId, 'paused');
      const updated = getMissionById(missionId);
      return NextResponse.json({ success: true, mission: updated });
    }

    // 4. Resume mission
    if (action === 'resume' && missionId) {
      updateMissionStatus(missionId, 'active');
      const updated = getMissionById(missionId);
      return NextResponse.json({ success: true, mission: updated });
    }

    // 5. Cancel mission
    if (action === 'cancel' && missionId) {
      updateMissionStatus(missionId, 'cancelled');
      const updated = getMissionById(missionId);
      return NextResponse.json({ success: true, mission: updated });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Mission error' }, { status: 500 });
  }
}
