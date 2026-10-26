import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const JOBS_FILE = path.join(STORAGE_DIR, 'jobs.json');

export interface BackgroundJob {
  id: string;
  agentId: string;
  taskType: 'research' | 'code_test' | 'doc_generation' | 'multi_agent_workflow';
  title: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  steps: {
    timestamp: string;
    step: string;
    tool?: string;
    output?: string;
  }[];
  result?: {
    summary: string;
    artifacts?: string[];
    citations?: string[];
  };
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

async function loadJobs(): Promise<Record<string, BackgroundJob>> {
  try {
    const raw = await fs.readFile(JOBS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveJobs(jobs: Record<string, BackgroundJob>): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const tempFile = `${JOBS_FILE}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(jobs, null, 2), 'utf8');
  await fs.rename(tempFile, JOBS_FILE);
}

/**
 * GET /api/jobs
 * Lists all queued and completed background worker jobs.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('id');
  const jobs = await loadJobs();

  if (jobId) {
    const job = jobs[jobId];
    if (!job) {
      return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });
    }
    return NextResponse.json({ job });
  }

  return NextResponse.json({
    jobs: Object.values(jobs).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    total: Object.keys(jobs).length,
  });
}

/**
 * POST /api/jobs
 * Enqueues or updates an autonomous background agent job with recoverable execution records.
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { action, agentId, taskType, title, prompt, jobId, status, progress, step, result, error } = body;
    const jobs = await loadJobs();

    // 1. Enqueue new job
    if (action === 'enqueue' || !action) {
      const newJobId = `job-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const newJob: BackgroundJob = {
        id: newJobId,
        agentId: agentId || 'agent-scout',
        taskType: taskType || 'research',
        title: title || 'Autonomous Background Task',
        prompt: prompt || '',
        status: 'queued',
        progress: 0,
        steps: [
          {
            timestamp: new Date().toISOString(),
            step: 'Job enqueued in recoverable server queue',
          },
        ],
        createdAt: new Date().toISOString(),
      };

      jobs[newJobId] = newJob;
      await saveJobs(jobs);

      return NextResponse.json({
        success: true,
        job: newJob,
      }, { status: 201 });
    }

    // 2. Update existing job progress / state
    if (action === 'update' && jobId) {
      const existing = jobs[jobId];
      if (!existing) {
        return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });
      }

      if (status) existing.status = status;
      if (typeof progress === 'number') existing.progress = progress;
      if (status === 'running' && !existing.startedAt) existing.startedAt = new Date().toISOString();
      if ((status === 'completed' || status === 'failed') && !existing.completedAt) {
        existing.completedAt = new Date().toISOString();
      }
      if (step) {
        existing.steps.push({
          timestamp: new Date().toISOString(),
          step: step.step || step,
          tool: step.tool,
          output: step.output,
        });
      }
      if (result) existing.result = result;
      if (error) existing.error = error;

      await saveJobs(jobs);
      return NextResponse.json({ success: true, job: existing });
    }

    // 3. Cancel job
    if (action === 'cancel' && jobId) {
      const existing = jobs[jobId];
      if (!existing) {
        return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });
      }
      existing.status = 'cancelled';
      existing.steps.push({
        timestamp: new Date().toISOString(),
        step: 'Job cancelled by user request',
      });
      await saveJobs(jobs);
      return NextResponse.json({ success: true, job: existing });
    }

    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
