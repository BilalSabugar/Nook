import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import {
  saveSpace,
  saveDocumentWithRevision,
  logAuditEvent,
} from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const STATE_FILE = path.join(STORAGE_DIR, 'workspace-state.json');

/**
 * POST /api/workspace/import
 * Imports a previously exported sovereign Nook workspace bundle.
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

    // 1. Import Spaces & Documents
    let importedSpacesCount = 0;
    let importedDocsCount = 0;

    if (Array.isArray(bundle.spaces)) {
      for (const space of bundle.spaces) {
        if (space?.id && space?.name) {
          saveSpace({ id: space.id, name: space.name, icon: space.icon || 'folder' });
          importedSpacesCount++;

          if (Array.isArray(space.pages)) {
            for (const page of space.pages) {
              if (page?.id && page?.title) {
                saveDocumentWithRevision({
                  id: page.id,
                  spaceId: space.id,
                  title: page.title,
                  content: page.content || '',
                  excerpt: page.excerpt,
                  icon: page.icon,
                  authorAgentId: page.authorAgentId || 'import',
                  tags: page.tags,
                  changeSummary: 'Restored from workspace import bundle',
                });
                importedDocsCount++;
              }
            }
          }
        }
      }
    }

    // 2. Import Workspace State
    if (bundle.workspace) {
      const stateToSave = {
        agents: bundle.workspace.agents || [],
        messages: bundle.workspace.messages || {},
        computerStates: bundle.workspace.computerStates || {},
        savedAt: new Date().toISOString(),
      };

      const tempFile = `${STATE_FILE}.${Date.now()}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(stateToSave, null, 2), 'utf8');
      await fs.rename(tempFile, STATE_FILE);
    }

    logAuditEvent('WORKSPACE_IMPORT', `Imported ${importedSpacesCount} spaces and ${importedDocsCount} documents`, 'success');

    return NextResponse.json({
      success: true,
      importedSpacesCount,
      importedDocsCount,
      importedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Import error' }, { status: 500 });
  }
}
