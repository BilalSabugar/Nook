import { NextRequest, NextResponse } from 'next/server.js';
import { validateApiRequest, unauthorizedResponse } from '../../../../lib/auth.ts';
import {
  exportWorkspaceSnapshot,
  scrubSensitiveData,
  seedInitialSpaces,
  computeSnapshotChecksum,
  computeSnapshotSignature,
  SAFE_SNAPSHOT_ID_PATTERN,
  SAFE_SNAPSHOT_FILENAME_PATTERN,
  MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT,
  MAX_SNAPSHOT_SANDBOX_FILE_BYTES,
} from '../../../../lib/db.ts';
import { INITIAL_SPACES } from '../../../../lib/store.ts';
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

    // Ensure computerStates accurately reflects safe, bounded files on server disk
    const rawComputerStates = workspaceState.computerStates && typeof workspaceState.computerStates === 'object'
      ? workspaceState.computerStates
      : {};
    const computerStates: Record<string, any> = {};
    for (const [agentId, st] of Object.entries(rawComputerStates)) {
      if (SAFE_SNAPSHOT_ID_PATTERN.test(agentId) && agentId !== '.' && agentId !== '..') {
        const rawFiles = Array.isArray((st as any)?.files) ? (st as any).files : [];
        const safeFiles = rawFiles
          .filter(
            (f: any) =>
              f &&
              typeof f.name === 'string' &&
              SAFE_SNAPSHOT_FILENAME_PATTERN.test(f.name) &&
              f.name !== '.' &&
              f.name !== '..' &&
              typeof f.content === 'string' &&
              Buffer.byteLength(f.content, 'utf8') <= MAX_SNAPSHOT_SANDBOX_FILE_BYTES
          )
          .slice(0, MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT);
        computerStates[agentId] = { ...(st as object), files: safeFiles };
      }
    }

    const sandboxesDir = path.join(STORAGE_DIR, 'sandboxes');
    if (fsSync.existsSync(sandboxesDir)) {
      try {
        const agentEntries = await fs.readdir(sandboxesDir, { withFileTypes: true });
        for (const entry of agentEntries) {
          if (entry.isDirectory()) {
            const agentId = entry.name;
            if (!SAFE_SNAPSHOT_ID_PATTERN.test(agentId) || agentId === '.' || agentId === '..') {
              continue;
            }
            const wsDir = path.join(sandboxesDir, agentId, 'workspace');
            if (fsSync.existsSync(wsDir)) {
              const fileEntries = await fs.readdir(wsDir, { withFileTypes: true });
              const files: Array<{ name: string; content: string }> = [];
              for (const fe of fileEntries) {
                if (fe.isFile() && SAFE_SNAPSHOT_FILENAME_PATTERN.test(fe.name) && fe.name !== '.' && fe.name !== '..') {
                  try {
                    const content = await fs.readFile(path.join(wsDir, fe.name), 'utf8');
                    if (Buffer.byteLength(content, 'utf8') <= MAX_SNAPSHOT_SANDBOX_FILE_BYTES) {
                      files.push({ name: fe.name, content });
                    }
                    if (files.length >= MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT) break;
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

    if (exportBundle.manifest) {
      const finalChecksum = `sha256:${computeSnapshotChecksum(exportBundle)}`;
      const finalSignature = computeSnapshotSignature(finalChecksum);
      exportBundle.manifest.checksum = finalChecksum;
      exportBundle.manifest.integrityChecksum = finalChecksum;
      if (finalSignature) {
        exportBundle.manifest.signature = finalSignature;
      } else {
        delete exportBundle.manifest.signature;
      }
    }

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
