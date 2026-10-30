import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { exportWorkspaceSnapshot, scrubSensitiveData } from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const STATE_FILE = path.join(STORAGE_DIR, 'workspace-state.json');

/**
 * GET /api/workspace/export
 * Exports complete, sovereign user workspace bundle:
 * Spaces, documents, revisions, missions, full tasks, evidence logs, and conversations.
 * Security requirement: Private API keys and master secrets are NEVER included.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    let workspaceState: any = {};
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8');
      workspaceState = JSON.parse(raw);
    } catch {}

    const snapshot = exportWorkspaceSnapshot();

    const exportBundle = scrubSensitiveData({
      ...snapshot,
      workspace: {
        agents: workspaceState.agents || [],
        messages: workspaceState.messages || {},
        computerStates: workspaceState.computerStates || {},
      },
    });

    return new NextResponse(JSON.stringify(exportBundle, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nook-workspace-export-${Date.now()}.json"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Export error' }, { status: 500 });
  }
}
