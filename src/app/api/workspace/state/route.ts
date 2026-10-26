import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import {
  saveSpace,
  saveDocumentWithRevision,
  listSpacesWithDocuments,
  listDocumentRevisions,
  rollbackDocumentToVersion,
  logAuditEvent,
} from '@/lib/db';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const STATE_FILE = path.join(STORAGE_DIR, 'workspace-state.json');

/**
 * GET /api/workspace/state
 * Retrieves durable workspace state, documents, spaces, and revision histories.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const { searchParams } = new URL(req.url);
  const docId = searchParams.get('documentId');
  const action = searchParams.get('action');

  // Query revisions for a document
  if (action === 'revisions' && docId) {
    const revisions = listDocumentRevisions(docId);
    return NextResponse.json({ documentId: docId, revisions });
  }

  try {
    let fileData: any = null;
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8');
      fileData = JSON.parse(raw);
    } catch {}

    // Check transactional database for spaces & documents
    const dbSpaces = listSpacesWithDocuments();

    return NextResponse.json({
      hasDurableState: Boolean(fileData || dbSpaces.length > 0),
      data: {
        ...(fileData || {}),
        spaces: dbSpaces.length > 0 ? dbSpaces : (fileData?.spaces || []),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/workspace/state
 * Durably saves agent states, living spaces, documents with revision logs, and sandboxes.
 * Critical security requirement: Strips all API keys from persisted settings.
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const payload = await req.json();
    const { action, agents, spaces, computerStates, messages, settings, documentId, targetVersion } = payload;

    // Handle document rollback to a previous version
    if (action === 'rollback' && documentId && targetVersion) {
      const rolledBack = rollbackDocumentToVersion(documentId, targetVersion);
      return NextResponse.json({
        success: true,
        message: `Successfully rolled back document to v${targetVersion}`,
        document: rolledBack,
      });
    }

    await fs.mkdir(STORAGE_DIR, { recursive: true });

    // Sanitize settings: strip private secrets from general workspace state
    const sanitizedSettings = settings
      ? {
          provider: settings.provider,
          model: settings.model,
          ollamaEndpoint: settings.ollamaEndpoint,
          // Explicitly omit geminiApiKey, openaiApiKey, anthropicApiKey
        }
      : undefined;

    // Persist spaces and documents into transactional SQLite database with revision tracking
    if (Array.isArray(spaces)) {
      for (const space of spaces) {
        if (space?.id && space?.name) {
          saveSpace({ id: space.id, name: space.name, icon: space.icon || 'folder' });

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
                  authorAgentId: page.authorAgentId || 'unknown',
                  tags: page.tags,
                  changeSummary: `Updated from client sync`,
                });
              }
            }
          }
        }
      }
    }

    // Atomic write for workspace state JSON backup
    const tempFile = `${STATE_FILE}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(
      {
        agents,
        spaces,
        computerStates,
        messages,
        settings: sanitizedSettings,
        savedAt: new Date().toISOString(),
      },
      null,
      2
    );

    await fs.writeFile(tempFile, serialized, 'utf8');
    await fs.rename(tempFile, STATE_FILE);

    // Persist per-agent workspace files on durable server disk
    if (computerStates && typeof computerStates === 'object') {
      for (const [agentId, compState] of Object.entries<any>(computerStates)) {
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

    logAuditEvent('WORKSPACE_SYNC', 'Synchronized workspace state, spaces, and sandboxes', 'success');

    return NextResponse.json({
      success: true,
      savedAt: new Date().toISOString(),
      storageDirectory: STORAGE_DIR,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
