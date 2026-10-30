import { NextRequest, NextResponse } from 'next/server.js';
import fs from 'fs/promises';
import path from 'path';
import { validateApiRequest, unauthorizedResponse } from '../../../../lib/auth.ts';
import {
  saveSpace,
  saveDocumentWithRevision,
  listSpacesWithDocuments,
  listDocumentRevisions,
  rollbackDocumentToVersion,
  logAuditEvent,
  scrubSensitiveData,
  SAFE_SNAPSHOT_ID_PATTERN,
  SAFE_SNAPSHOT_FILENAME_PATTERN,
  MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT,
  MAX_SNAPSHOT_SANDBOX_FILE_BYTES,
} from '../../../../lib/db.ts';
import {
  ensureRealDirectoryWithin,
  writeFileNoFollow,
} from '../../../../lib/safe-workspace.mjs';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const STATE_FILE = path.join(STORAGE_DIR, 'workspace-state.json');

/**
 * Validates client-supplied `computerStates` before any filesystem or database mutation.
 * Strictly blocks path traversal (`..`, `/`, `\`), invalid agent IDs, unsafe filenames, and oversized payloads.
 */
function validateComputerStatesInput(computerStates: unknown): { valid: boolean; error?: string } {
  if (computerStates === undefined || computerStates === null) {
    return { valid: true };
  }
  if (typeof computerStates !== 'object' || Array.isArray(computerStates)) {
    return { valid: false, error: 'Field "computerStates" must be a non-array object map of agentId -> state' };
  }

  for (const [agentId, compState] of Object.entries(computerStates as Record<string, unknown>)) {
    if (
      !SAFE_SNAPSHOT_ID_PATTERN.test(agentId) ||
      agentId === '.' ||
      agentId === '..' ||
      agentId.includes('/') ||
      agentId.includes('\\')
    ) {
      return {
        valid: false,
        error: `Invalid or unsafe agentId in computerStates: "${agentId}" (must match ^[A-Za-z0-9_-]{1,64}$)`,
      };
    }

    if (compState !== null && compState !== undefined) {
      if (typeof compState !== 'object' || Array.isArray(compState)) {
        return { valid: false, error: `computerStates["${agentId}"] must be an object` };
      }
      const files = (compState as { files?: unknown }).files;
      if (files !== undefined) {
        if (!Array.isArray(files)) {
          return { valid: false, error: `computerStates["${agentId}"].files must be an array` };
        }
        if (files.length > MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT) {
          return {
            valid: false,
            error: `computerStates["${agentId}"].files exceeds limit of ${MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT} files`,
          };
        }
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as { name?: unknown; content?: unknown };
          if (!file || typeof file !== 'object') {
            return { valid: false, error: `Invalid file entry at computerStates["${agentId}"].files[${i}]` };
          }
          const fileName = typeof file.name === 'string' ? file.name : '';
          if (
            !SAFE_SNAPSHOT_FILENAME_PATTERN.test(fileName) ||
            fileName === '.' ||
            fileName === '..' ||
            fileName.includes('/') ||
            fileName.includes('\\')
          ) {
            return {
              valid: false,
              error: `Unsafe or invalid filename "${fileName}" in computerStates["${agentId}"]`,
            };
          }
          if (typeof file.content !== 'string') {
            return {
              valid: false,
              error: `File "${fileName}" in computerStates["${agentId}"] must have string content`,
            };
          }
          if (Buffer.byteLength(file.content, 'utf8') > MAX_SNAPSHOT_SANDBOX_FILE_BYTES) {
            return {
              valid: false,
              error: `File "${fileName}" in computerStates["${agentId}"] exceeds maximum size of ${MAX_SNAPSHOT_SANDBOX_FILE_BYTES} bytes`,
            };
          }
        }
      }
    }
  }

  return { valid: true };
}

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

    // Validate client-supplied computerStates BEFORE any SQLite or filesystem writes
    const csValidation = validateComputerStatesInput(computerStates);
    if (!csValidation.valid) {
      return NextResponse.json({ error: csValidation.error }, { status: 400 });
    }

    await ensureRealDirectoryWithin(process.cwd(), STORAGE_DIR);

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

    // Atomic no-follow write for workspace state JSON backup with sensitive data scrubbing
    const serialized = JSON.stringify(
      scrubSensitiveData({
        agents,
        spaces,
        computerStates,
        messages,
        settings: sanitizedSettings,
        savedAt: new Date().toISOString(),
      }),
      null,
      2
    );

    await writeFileNoFollow(STORAGE_DIR, 'workspace-state.json', serialized);

    // Persist per-agent workspace files on durable server disk using strict realpath & O_NOFOLLOW confinement
    if (computerStates && typeof computerStates === 'object') {
      const sandboxesRoot = path.join(STORAGE_DIR, 'sandboxes');
      await ensureRealDirectoryWithin(STORAGE_DIR, sandboxesRoot);

      for (const [agentId, compState] of Object.entries<any>(computerStates)) {
        if (compState?.files && Array.isArray(compState.files)) {
          const agentDiskDir = path.join(sandboxesRoot, agentId, 'workspace');
          await ensureRealDirectoryWithin(sandboxesRoot, agentDiskDir);

          for (const file of compState.files) {
            if (file?.name && typeof file?.content === 'string') {
              await writeFileNoFollow(agentDiskDir, file.name, file.content);
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
