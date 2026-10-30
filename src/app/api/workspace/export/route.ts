import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { exportWorkspaceSnapshot, scrubSensitiveData, seedInitialSpaces } from '@/lib/db';
import { INITIAL_SPACES } from '@/lib/store';
import fs from 'fs/promises';
import fsSync from 'fs';
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

    let snapshot = exportWorkspaceSnapshot();
    if (!snapshot.spaces || snapshot.spaces.length === 0) {
      if (workspaceState.spaces && workspaceState.spaces.length > 0) {
        seedInitialSpaces(workspaceState.spaces);
      } else {
        seedInitialSpaces(INITIAL_SPACES);
      }
      snapshot = exportWorkspaceSnapshot();
    }

    // Ensure computerStates accurately reflects files on server disk
    const computerStates = { ...(workspaceState.computerStates || {}) };
    const sandboxesDir = path.join(STORAGE_DIR, 'sandboxes');
    if (fsSync.existsSync(sandboxesDir)) {
      try {
        const agentEntries = await fs.readdir(sandboxesDir, { withFileTypes: true });
        for (const entry of agentEntries) {
          if (entry.isDirectory()) {
            const agentId = entry.name;
            const wsDir = path.join(sandboxesDir, agentId, 'workspace');
            if (fsSync.existsSync(wsDir)) {
              const fileEntries = await fs.readdir(wsDir, { withFileTypes: true });
              const files: Array<{ name: string; content: string }> = [];
              for (const fe of fileEntries) {
                if (fe.isFile()) {
                  try {
                    const content = await fs.readFile(path.join(wsDir, fe.name), 'utf8');
                    files.push({ name: fe.name, content });
                  } catch {}
                }
              }
              if (files.length > 0) {
                computerStates[agentId] = {
                  ...(computerStates[agentId] || {}),
                  files,
                };
              }
            }
          }
        }
      } catch {}
    }

    const exportBundle = scrubSensitiveData({
      ...snapshot,
      workspace: {
        agents: workspaceState.agents || [],
        messages: workspaceState.messages || {},
        computerStates,
        settings: workspaceState.settings || undefined,
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
