#!/usr/bin/env node
/**
 * Nook Dedicated Persistent Background Worker Process
 * Autonomously supervises background jobs and multi-agent missions without an open browser.
 * Provides lease management, crash recovery, cancellation, and graceful shutdown.
 */

import {
  tickWorker,
  recoverStaleJobsAndMissions,
} from '../src/lib/worker.ts';
import { logAuditEvent } from '../src/lib/db.ts';

console.log('[Nook Supervisor] Starting dedicated persistent worker process...');

// 1. Run initial crash recovery on startup
const recovery = recoverStaleJobsAndMissions();
if (recovery.recoveredJobs > 0 || recovery.recoveredMissions > 0) {
  console.log(`[Nook Supervisor] Crash recovery completed: restored ${recovery.recoveredJobs} stale job(s) and ${recovery.recoveredMissions} mission task(s).`);
}

logAuditEvent('SUPERVISOR_ONLINE', 'Dedicated background worker process started', 'success');

let isRunning = true;

// 2. Graceful termination handlers
function handleShutdown(signal) {
  console.log(`\n[Nook Supervisor] Received ${signal}. Shutting down worker supervisor gracefully...`);
  isRunning = false;
  logAuditEvent('SUPERVISOR_SHUTDOWN', `Dedicated worker process stopped (${signal})`, 'success');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// 3. Persistent execution loop
async function supervisorLoop() {
  while (isRunning) {
    try {
      await tickWorker();
    } catch (err) {
      console.error('[Nook Supervisor] Error during worker tick:', err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

supervisorLoop().catch((err) => {
  console.error('[Nook Supervisor] Fatal supervisor process error:', err);
  process.exit(1);
});
