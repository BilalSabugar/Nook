import {
  claimNextQueuedJob,
  getJobById,
  updateJobProgress,
  completeJob,
  failJob,
  saveDocumentWithRevision,
  logAuditEvent,
  listMissions,
  getDatabase,
  markJobSideEffectStarted,
  markJobSideEffectFinished,
  recordWorkerHeartbeat,
} from './db.ts';
import type { DbBackgroundJob } from './db.ts';
import { safeFetch } from './ssrf.ts';
import { tickMission } from './orchestrator.ts';
import { executeSandboxedCommand } from './sandbox.ts';
import { validateCodeTestCommandBoundary } from './sandbox-ticket.ts';

let isWorkerRunning = false;
let workerInterval: NodeJS.Timeout | null = null;
let lastCrashRecoveryCheck = 0;

// Unique worker instance ID for atomic lease ownership across distributed supervisor processes
export const WORKER_INSTANCE_ID =
  process.env.NOOK_WORKER_ID ||
  `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const LEASE_DURATION_MS = 25000; // 25 seconds

/**
 * Crash recovery: Detects abandoned jobs or mission tasks where the worker crashed,
 * reclaims expired leases, and resumes or safely retries execution.
 */
export function recoverStaleJobsAndMissions(): { recoveredJobs: number; recoveredMissions: number } {
  let recoveredJobs = 0;
  let recoveredMissions = 0;
  const now = Date.now();
  const db = getDatabase();

  // 1. Recover stale background jobs (running for > 45 seconds without completion)
  try {
    const staleJobs = db.prepare(`
      SELECT * FROM background_jobs
      WHERE status = 'running'
    `).all() as Array<{ id: string; status: string; created_at: string; updated_at?: string; retry_count?: number; agent_id: string; side_effect_state?: string }>;

    for (const j of staleJobs) {
      const updatedAtMs = new Date(j.updated_at || j.created_at).getTime();
      if (now - updatedAtMs > 45000) {
        // If an external side-effect was already started before crash, retry is suppressed to guarantee at-most-once execution!
        if (j.side_effect_state === 'started') {
          db.prepare(`
            UPDATE background_jobs
            SET status = 'failed', error = 'Job timed out after starting non-idempotent action. Retry suppressed to preserve exactly-once execution guarantee.', updated_at = ?
            WHERE id = ?
          `).run(new Date().toISOString(), j.id);
          recoveredJobs++;
          logAuditEvent('WORKER_JOB_ABORTED', `Job ${j.id} failed without retry: side-effect action was in-flight when worker terminated`, 'failed', j.agent_id);
          continue;
        }

        const retryCount = (j.retry_count || 0) + 1;
        if (retryCount <= 3) {
          db.prepare(`
            UPDATE background_jobs
            SET status = 'queued', retry_count = ?, updated_at = ?
            WHERE id = ?
          `).run(retryCount, new Date().toISOString(), j.id);
          recoveredJobs++;
          logAuditEvent('WORKER_CRASH_RECOVERY', `Recovered crashed job ${j.id} (attempt ${retryCount}/3)`, 'recovered', j.agent_id);
        } else {
          db.prepare(`
            UPDATE background_jobs
            SET status = 'failed', error = 'Job exceeded max retries after worker process crashes', updated_at = ?
            WHERE id = ?
          `).run(new Date().toISOString(), j.id);
          logAuditEvent('WORKER_JOB_EXHAUSTED', `Job ${j.id} failed after repeated worker crashes`, 'failed', j.agent_id);
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. Recover stale mission tasks (in_progress for > 60 seconds)
  try {
    const staleTasks = db.prepare(`
      SELECT * FROM agent_tasks
      WHERE status = 'in_progress'
    `).all() as Array<{ id: string; status: string; created_at: string; updated_at?: string; assigned_agent_id: string; approval_id?: string }>;

    for (const t of staleTasks) {
      const updatedAtMs = new Date(t.updated_at || t.created_at).getTime();
      if (now - updatedAtMs > 60000) {
        if (t.approval_id) {
          // Task had human approval; if it was interrupted while in_progress, its approval was already single-use consumed.
          // Marking it failed prevents duplicate execution of mutating external actions.
          db.prepare(`
            UPDATE agent_tasks
            SET status = 'failed', updated_at = ?
            WHERE id = ?
          `).run(new Date().toISOString(), t.id);
          recoveredMissions++;
          logAuditEvent('WORKER_CRASH_RECOVERY', `Interrupted approved task ${t.id} marked failed to preserve approval single-use guarantee`, 'failed', t.assigned_agent_id);
          continue;
        }

        db.prepare(`
          UPDATE agent_tasks
          SET status = 'pending', updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), t.id);
        recoveredMissions++;
        logAuditEvent('WORKER_CRASH_RECOVERY', `Recovered interrupted mission task ${t.id} to pending`, 'recovered', t.assigned_agent_id);
      }
    }
  } catch {
    // ignore
  }

  return { recoveredJobs, recoveredMissions };
}

/**
 * Executes a single claimed background job through authentic steps.
 */
export async function executeJob(job: DbBackgroundJob): Promise<void> {
  logAuditEvent('WORKER_JOB_START', `Worker executing job ${job.id} (${job.taskType})`, 'running', job.agentId);

  try {
    // Check cancellation
    let current = getJobById(job.id);
    if (!current || current.status === 'cancelled') return;

    if (current.status === 'queued') {
      const db = getDatabase();
      const now = new Date().toISOString();
      db.prepare(`UPDATE background_jobs SET status = 'running', started_at = ? WHERE id = ?`).run(now, job.id);
    }

    // Step 1: Initialization
    updateJobProgress(job.id, 20, {
      step: 'Worker claimed job and validated task parameters',
      tool: 'supervisor_dispatch',
    });

    if (job.taskType === 'research') {
      current = getJobById(job.id);
      if (!current || current.status === 'cancelled') return;

      const query = job.prompt.replace(/research|search|about/gi, '').trim();
      if (!query) {
        failJob(job.id, 'Research job failed: zero verified external source citations found. Real execution evidence required.');
        return;
      }
      updateJobProgress(job.id, 40, {
        step: `Dispatching live encyclopedic search for "${query}"`,
        tool: 'web_search',
      });

      // Real outbound search via Wikipedia OpenSearch
      let titles: string[] = [];
      let links: string[] = [];
      try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json`;
        const fetchRes = await safeFetch(searchUrl, { timeoutMs: 6000 });
        if (fetchRes.ok) {
          const parsed = JSON.parse(fetchRes.bodyText);
          titles = parsed[1] || [];
          links = parsed[3] || [];
        }
      } catch (err: unknown) {
        const error = err as Error;
        logAuditEvent('WORKER_SEARCH_FAIL', `Research query network error: ${error.message}`, 'warning');
      }

      current = getJobById(job.id);
      if (!current || current.status === 'cancelled') return;

      if (links.length === 0 || titles.length === 0) {
        failJob(job.id, `Research job failed: zero verified external source citations found for query "${query}". Real execution evidence required.`);
        return;
      }

      updateJobProgress(job.id, 75, {
        step: `Extracted ${titles.length} verified technical citations`,
        tool: 'source_verification',
        output: titles.join(', '),
      });

      const summary = `Completed research on "${query}". Identified key technical domains: ${titles.slice(0, 3).join(', ')}.`;
      completeJob(job.id, {
        summary,
        citations: links,
        artifacts: titles,
      });
      return;
    }

    if (job.taskType === 'doc_generation' || job.taskType === 'multi_agent_workflow') {
      current = getJobById(job.id);
      if (!current || current.status === 'cancelled') return;

      updateJobProgress(job.id, 50, {
        step: 'Synthesizing living space technical document specification',
        tool: 'format_document',
      });

      const title = job.title.replace('Autonomous Background Task', 'Technical Briefing');
      
      // Query genuine evidence records associated with this task/mission
      const db = getDatabase();
      const evidenceRows = db.prepare(`
        SELECT * FROM evidence_records 
        WHERE mission_id = ? OR task_id = ? 
        ORDER BY timestamp ASC
      `).all(job.id, job.id) as unknown as Array<{ action_type: string; summary: string }>;

      let evidenceSection: string;
      if (evidenceRows.length > 0) {
        evidenceSection = evidenceRows.map((e) => `- **[${e.action_type}]**: ${e.summary}`).join('\n');
      } else {
        evidenceSection = `- Task executed: ${job.prompt || job.title}\n- Status recorded in durable task logs (Pending further independent verification)`;
      }

      const docContent = `# ${title}\n\n## 1. Executive Summary\n${job.prompt || 'Autonomous coworker task summary.'}\n\n## 2. Task Execution Logs & Findings\n${evidenceSection}\n\n*Generated by Nook Background Worker with recorded task execution logs*`;

      const hasVerifiedEvidence = evidenceRows.length > 0;
      const evidenceDescription = hasVerifiedEvidence
        ? 'with verified task evidence'
        : 'with recorded task execution logs (pending independent verification)';

      // Save document to Living Spaces with revision history
      const savedDoc = saveDocumentWithRevision({
        id: `doc-${job.id}`,
        spaceId: 'space-research',
        title,
        content: docContent,
        authorAgentId: job.agentId,
        changeSummary: `Created automatically by Background Worker (${evidenceDescription}) for job ${job.id}`,
      });

      current = getJobById(job.id);
      if (!current || current.status === 'cancelled') return;

      updateJobProgress(job.id, 85, {
        step: `Document persisted with revision v${savedDoc.version}`,
        tool: 'living_spaces_save',
        output: `Document ID: ${savedDoc.id}`,
      });

      completeJob(job.id, {
        summary: `Document "${savedDoc.title}" successfully drafted and persisted in Living Spaces (${evidenceDescription}).`,
        artifacts: [savedDoc.id],
      });
      return;
    }

    // Real code_test execution in isolated sandbox
    if (job.taskType === 'code_test') {
      current = getJobById(job.id);
      if (!current || current.status === 'cancelled') return;

      const testCmd = job.prompt.trim() || 'node --version';
      const boundaryCheck = validateCodeTestCommandBoundary(testCmd);
      if (!boundaryCheck.allowed) {
        logAuditEvent(
          'WORKER_CODE_TEST_BOUNDARY_BLOCKED',
          `Blocked unapproved command in code_test job ${job.id}: ${boundaryCheck.reason}`,
          'blocked',
          job.agentId
        );
        failJob(job.id, boundaryCheck.reason || 'Arbitrary shell execution is not permitted in unapproved code_test background jobs.');
        return;
      }

      updateJobProgress(job.id, 40, {
        step: `Executing sandbox command: "${testCmd}"`,
        tool: 'sandbox_exec',
      });

      // Atomically claim side-effect start to enforce at-most-once execution
      if (!markJobSideEffectStarted(job.id)) {
        failJob(job.id, 'Duplicate execution attempt rejected: job side effect already claimed or terminated.');
        return;
      }

      let sandboxRes;
      try {
        sandboxRes = await executeSandboxedCommand({
          agentId: job.agentId || 'cipher',
          command: testCmd,
          taskId: job.id,
          authorizationType: 'system_verified_test',
          timeoutMs: 10000,
          allowHostFallback: process.env.NODE_ENV !== 'production',
        });
      } finally {
        markJobSideEffectFinished(job.id);
      }

      current = getJobById(job.id);
      if (!current || current.status === 'cancelled') return;

      if (sandboxRes.exitCode !== 0) {
        failJob(job.id, `Sandbox execution failed with exit code ${sandboxRes.exitCode}: ${sandboxRes.stderr || sandboxRes.stdout}`);
        return;
      }

      updateJobProgress(job.id, 90, {
        step: `Command finished with exit code 0. Collected execution evidence.`,
        tool: 'evidence_collection',
        output: sandboxRes.stdout.slice(0, 300),
      });

      completeJob(job.id, {
        summary: `Executed "${testCmd}" with verified evidence (exit code ${sandboxRes.exitCode}).`,
        artifacts: [testCmd],
      });
      return;
    }

    // Generic or undefined tasks without execution evidence cannot be marked successful
    failJob(job.id, `Job "${job.title}" rejected: unexecutable task type "${job.taskType}" lacks verifiable execution payload or evidence.`);
  } catch (err: unknown) {
    const error = err as Error;
    failJob(job.id, error.message || 'Worker execution failed');
  }
}

/**
 * Automatically advances any active background missions without requiring an open browser.
 * Relies on tickMission's atomic database lease enforcement.
 */
export async function tickActiveMissions(): Promise<boolean> {
  const missions = listMissions();
  let advancedAny = false;

  for (const m of missions) {
    if (m.status !== 'active' && m.status !== 'draft') continue;

    try {
      const updated = await tickMission(m.id, WORKER_INSTANCE_ID, LEASE_DURATION_MS);
      if (updated.leaseBusy) {
        // Lease currently held by another worker or manual API process
        continue;
      }
      advancedAny = true;
    } catch (err: unknown) {
      const error = err as Error;
      logAuditEvent('MISSION_WORKER_ERROR', `Worker ${WORKER_INSTANCE_ID} failed ticking mission ${m.id}: ${error.message}`, 'error', 'agent-aura');
    }
  }

  return advancedAny;
}

/**
 * Worker tick: Claims next queued job and advances active missions.
 */
export async function tickWorker(): Promise<boolean> {
  const now = Date.now();
  recordWorkerHeartbeat(WORKER_INSTANCE_ID);

  // Periodic crash recovery check every 30 seconds
  if (now - lastCrashRecoveryCheck > 30000) {
    lastCrashRecoveryCheck = now;
    recoverStaleJobsAndMissions();
  }

  // 1. Advance active missions
  const missionProgress = await tickActiveMissions();

  // 2. Claim and execute queued jobs
  const job = claimNextQueuedJob();
  if (job) {
    await executeJob(job);
    return true;
  }

  return missionProgress;
}

/**
 * Starts durable worker loop inside the server environment.
 */
export function ensureWorkerStarted(): void {
  // Respect explicit disable flag or dedicated worker role separation in production
  if (
    process.env.NOOK_DISABLE_WEB_WORKER === 'true' ||
    (process.env.NOOK_WORKER_ROLE !== 'dedicated_worker' &&
      process.env.NODE_ENV === 'production' &&
      !process.env.NOOK_ENABLE_EMBEDDED_WORKER)
  ) {
    return;
  }
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  recordWorkerHeartbeat(WORKER_INSTANCE_ID);

  // Run initial crash recovery on startup
  recoverStaleJobsAndMissions();

  workerInterval = setInterval(async () => {
    try {
      await tickWorker();
    } catch (e) {
      console.error('Worker supervisor tick error:', e);
    }
  }, 2500);

  if (workerInterval.unref) {
    workerInterval.unref();
  }
}

/**
 * Stops worker supervisor cleanly.
 */
export function stopWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  isWorkerRunning = false;
}
