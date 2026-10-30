import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { importWorkspaceSnapshot } from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const STATE_FILE = path.join(STORAGE_DIR, 'workspace-state.json');

/**
 * POST /api/workspace/import
 * Imports a previously exported sovereign Nook workspace bundle (v1 or v2).
 * Reconstructs complete spaces, documents, revisions, missions, tasks, and evidence.
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const bundle = await req.json();

    if (!bundle || typeof bundle !== 'object' || !bundle.schemaVersion) {
      return NextResponse.json({
        error: 'Invalid workspace bundle. Missing schemaVersion.',
      }, { status: 400 });
    }

    await fs.mkdir(STORAGE_DIR, { recursive: true });

    // 1. Import Workspace State file (UI agents, messages, computer states, spaces, settings)
    if (bundle.workspace || bundle.spaces) {
      const stateToSave = {
        agents: bundle.workspace?.agents || [],
        messages: bundle.workspace?.messages || {},
        computerStates: bundle.workspace?.computerStates || {},
        spaces: bundle.spaces || [],
        settings: bundle.workspace?.settings || bundle.settings || undefined,
        savedAt: new Date().toISOString(),
      };

      const tempFile = `${STATE_FILE}.${Date.now()}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(stateToSave, null, 2), 'utf8');
      await fs.rename(tempFile, STATE_FILE);

      // Restore sandbox files to disk
      if (bundle.workspace?.computerStates && typeof bundle.workspace.computerStates === 'object') {
        for (const [agentId, compState] of Object.entries<any>(bundle.workspace.computerStates)) {
          if (compState?.files && Array.isArray(compState.files)) {
            const agentDiskDir = path.join(STORAGE_DIR, 'sandboxes', agentId, 'workspace');
            await fs.mkdir(agentDiskDir, { recursive: true });

            for (const file of compState.files) {
              if (file?.name && typeof file?.content === 'string') {
                const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
                if (safeName) {
                  await fs.writeFile(path.join(agentDiskDir, safeName), file.content, 'utf8');
                }
              }
            }
          }
        }
      }
    }

    // 2. Durable Database Restore via transaction
    const result = importWorkspaceSnapshot(bundle);

    return NextResponse.json({
      success: true,
      importedSpacesCount: result.importedSpacesCount,
      importedDocsCount: result.importedDocsCount,
      importedRevisionsCount: result.importedRevisionsCount,
      importedMissionsCount: result.importedMissionsCount,
      importedTasksCount: result.importedTasksCount,
      importedEvidenceCount: result.importedEvidenceCount,
      importedApprovalsCount: result.importedApprovalsCount,
      importedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Import error' }, { status: 500 });
  }
}
