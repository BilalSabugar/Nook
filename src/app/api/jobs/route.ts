import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import {
  enqueueJob,
  listJobs,
  getJobById,
  cancelJob,
} from '@/lib/db';
import { ensureWorkerStarted, tickWorker } from '@/lib/worker';

// Start the background worker process
ensureWorkerStarted();

/**
 * GET /api/jobs
 * Lists queued and completed background worker jobs.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('id');

  if (jobId) {
    const job = getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });
    }
    return NextResponse.json({ job });
  }

  const jobs = listJobs();
  return NextResponse.json({
    jobs,
    total: jobs.length,
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /api/jobs
 * Enqueues or cancels background worker tasks.
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { action, agentId, taskType, title, prompt, jobId } = body;

    // 1. Enqueue new job
    if (action === 'enqueue' || !action) {
      const job = enqueueJob({
        agentId: agentId || 'agent-scout',
        taskType: taskType || 'research',
        title: title || 'Autonomous Background Task',
        prompt: prompt || '',
      });

      // Proactively trigger worker tick so execution starts immediately
      tickWorker().catch(() => {});

      return NextResponse.json({
        success: true,
        job,
      }, { status: 201 });
    }

    // 2. Cancel job
    if (action === 'cancel' && jobId) {
      const cancelled = cancelJob(jobId);
      if (!cancelled) {
        return NextResponse.json({ error: `Job ${jobId} could not be cancelled or not found` }, { status: 400 });
      }
      const updated = getJobById(jobId);
      return NextResponse.json({ success: true, job: updated });
    }

    // 3. Worker manual tick trigger
    if (action === 'tick') {
      const processed = await tickWorker();
      return NextResponse.json({ success: true, processed });
    }

    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
