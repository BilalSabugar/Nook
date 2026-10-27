import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { listEvidence, exportRedactedActivityReport } from '@/lib/db';

/**
 * GET /api/missions/evidence
 * Retrieves immutable evidence records or generates a redacted activity report.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const { searchParams } = new URL(req.url);
  const missionId = searchParams.get('missionId') || undefined;
  const taskId = searchParams.get('taskId') || undefined;
  const agentId = searchParams.get('agentId') || undefined;
  const shouldExport = searchParams.get('export') === 'true';

  if (shouldExport) {
    const report = exportRedactedActivityReport(missionId);
    return NextResponse.json({ report });
  }

  const records = listEvidence({ missionId, taskId, agentId });
  return NextResponse.json({
    total: records.length,
    records,
    timestamp: new Date().toISOString(),
  });
}
