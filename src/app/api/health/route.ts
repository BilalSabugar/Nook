import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';

export async function GET(req: NextRequest) {
  let dbStatus = 'ok';
  try {
    const db = getDatabase();
    db.prepare('SELECT 1').get();
  } catch {
    dbStatus = 'unavailable';
  }

  let runnerStatus = 'not_configured';
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

  const isReadinessCheck = req.nextUrl.searchParams.get('readiness') === 'true';
  const isHealthy = dbStatus === 'ok' && (!isReadinessCheck || runnerStatus === 'ok' || runnerStatus === 'not_configured');

  return NextResponse.json({
    status: isHealthy ? 'ok' : 'degraded',
    healthy: isHealthy,
    name: 'Nook Agent Operating System',
    mode: 'vibe-coded',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    subsystems: {
      database: dbStatus,
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
