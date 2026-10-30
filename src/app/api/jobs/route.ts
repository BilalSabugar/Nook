import { NextRequest, NextResponse } from 'next/server.js';
import { validateApiRequest, unauthorizedResponse } from '../../../lib/auth.ts';
import {
  enqueueJob,
  listJobs,
  getJobById,
  cancelJob,
  logAuditEvent,
} from '../../../lib/db.ts';
import { ensureWorkerStarted, tickWorker } from '../../../lib/worker.ts';
import { validateCodeTestCommandBoundary } from '../../../lib/sandbox-ticket.ts';

// Start the background worker process unless explicitly disabled for a dedicated worker deployment
if (process.env.NOOK_DISABLE_WEB_WORKER !== 'true') {
  ensureWorkerStarted();
}

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
      const resolvedTaskType = taskType || 'research';
      const resolvedPrompt = typeof prompt === 'string' ? prompt : '';

      if (resolvedTaskType === 'code_test') {
        if (auth.authMethod === 'api_key') {
          logAuditEvent(
            'JOB_ENQUEUE_BLOCKED',
            'Blocked machine API key from enqueuing code_test job without interactive human session',
            'blocked',
            agentId || 'agent-scout'
          );
          return NextResponse.json(
            {
              error: 'Machine API keys cannot enqueue code_test execution jobs without interactive owner session authentication.',
              code: 'CODE_TEST_REQUIRES_INTERACTIVE_OWNER',
            },
            { status: 403 }
          );
        }

        const cmdToCheck = resolvedPrompt.trim() || 'node --version';
        const boundary = validateCodeTestCommandBoundary(cmdToCheck);
        if (!boundary.allowed) {
          logAuditEvent(
            'JOB_ENQUEUE_BLOCKED',
            `Rejected arbitrary command in code_test job enqueue: ${boundary.reason}`,
            'blocked',
            agentId || 'agent-scout'
          );
          return NextResponse.json(
            {
              error: boundary.reason || 'Arbitrary shell commands are not permitted in code_test background jobs.',
              code: 'CODE_TEST_COMMAND_BOUNDARY_VIOLATION',
            },
            { status: 403 }
          );
        }
      }

      const job = enqueueJob({
        agentId: agentId || 'agent-scout',
        taskType: resolvedTaskType,
        title: title || 'Autonomous Background Task',
        prompt: resolvedPrompt,
      });

      // Proactively trigger worker tick unless web worker is disabled in dedicated worker topology
      if (process.env.NOOK_DISABLE_WEB_WORKER !== 'true') {
        tickWorker().catch(() => {});
      }

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
