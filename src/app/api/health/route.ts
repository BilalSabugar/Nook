import { NextRequest, NextResponse } from 'next/server.js';
import { getDatabase, getWorkerHeartbeatStatus } from '../../../lib/db.ts';

export async function GET(req: NextRequest) {
  let dbStatus: 'ok' | 'unavailable' = 'ok';
  try {
    const db = getDatabase();
    db.prepare('SELECT 1').get();
  } catch {
    dbStatus = 'unavailable';
  }

  let runnerStatus: 'ok' | 'unhealthy' | 'unreachable' | 'not_configured' = 'not_configured';
  if (process.env.SANDBOX_SERVICE_URL) {
    try {
      const res = await fetch(`${process.env.SANDBOX_SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      runnerStatus = res.ok ? 'ok' : 'unhealthy';
    } catch {
      runnerStatus = 'unreachable';
    }
  }

  const heartbeat = getWorkerHeartbeatStatus(60000);
  const workerStatus = heartbeat.status;

  const isReadinessCheck = req.nextUrl.searchParams.get('readiness') === 'true';
  const requireSandbox = req.nextUrl.searchParams.get('requireSandbox') === 'true' || Boolean(process.env.SANDBOX_SERVICE_URL);
  const requireWorker = req.nextUrl.searchParams.get('requireWorker') === 'true' || process.env.NOOK_DISABLE_WEB_WORKER === 'true';

  const sandboxReady = !requireSandbox ? (runnerStatus === 'ok' || runnerStatus === 'not_configured') : runnerStatus === 'ok';
  const workerReady = !requireWorker || workerStatus === 'ok';

  const isHealthy =
    dbStatus === 'ok' &&
    (!isReadinessCheck || (sandboxReady && workerReady));

  return NextResponse.json({
    status: isHealthy ? 'ok' : 'degraded',
    healthy: isHealthy,
    liveness: 'ok',
    readiness: dbStatus === 'ok' && sandboxReady && workerReady ? 'ready' : 'not_ready',
    name: 'Nook Agent Operating System',
    mode: 'vibe-coded',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    subsystems: {
      liveness: 'ok',
      database: dbStatus,
      worker: workerStatus,
      workerDetails: heartbeat,
      sandboxRunner: runnerStatus,
    },
    features: {
      vibeCoded: true,
      persistentAgents: true,
      agentComputerSandbox: true,
      spacesDocumentWorkspace: true,
      humanInTheLoopReviews: true,
      mcpIntegrations: true,
    },
    configuredProviders: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      ollama: Boolean(process.env.OLLAMA_BASE_URL),
    },
  }, {
    status: isHealthy ? 200 : 503,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
