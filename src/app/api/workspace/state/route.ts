import { NextRequest, NextResponse } from 'next/server.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateApiRequest, unauthorizedResponse } from '../../../../lib/auth.ts';
import {
  getDatabase,
  withWorkspaceMutationLock,
  saveSpace,
  saveDocumentWithRevision,
  listSpacesWithDocuments,
  listDocumentRevisions,
  rollbackDocumentToVersion,
  seedInitialSpaces,
  logAuditEvent,
  scrubSensitiveData,
  SAFE_SNAPSHOT_ID_PATTERN,
  SAFE_SNAPSHOT_FILENAME_PATTERN,
  MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT,
  MAX_SNAPSHOT_SANDBOX_FILE_BYTES,
} from '../../../../lib/db.ts';
import {
  INITIAL_AGENTS,
  INITIAL_SPACES,
  INITIAL_COMPUTER_STATES,
  INITIAL_MESSAGES,
  DEFAULT_LLM_SETTINGS,
} from '../../../../lib/store.ts';
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

export interface PersistWorkspaceStateOptions {
  beforeRenameHook?: (ctx: { tmpPath: string; target: string }) => Promise<void> | void;
  afterStateFileHook?: (ctx: { stateFile: string }) => Promise<void> | void;
  afterSandboxFileHook?: (ctx: {
    agentId: string;
    fileName: string;
    filePath: string;
    fileIndex: number;
  }) => Promise<void> | void;
}

/**
 * Atomically persists workspace state across SQLite, `.nook_storage/workspace-state.json`, and
 * per-agent `.nook_storage/sandboxes/<agentId>/workspace/*` files.
 * - Serializes concurrent workspace mutations via `withWorkspaceMutationLock` so shared SQLite
 *   savepoints and filesystem writes never interleave across overlapping requests.
 * - Combines `O_NOFOLLOW` protection with temporary-file write, `sync()` flush, and same-directory `rename`.
 * - Restores SQLite, `workspace-state.json`, and any modified/created sandbox files if an error occurs
 *   at any stage (before rename, after JSON replacement, or after sandbox file writes).
 */
export async function persistWorkspaceStatePayload(
  payload: Record<string, any>,
  options?: PersistWorkspaceStateOptions
): Promise<{ status: number; body: Record<string, any> }> {
  const { action, agents, spaces, computerStates, messages, settings, documentId, targetVersion } = payload || {};

  // Validate client-supplied computerStates BEFORE acquiring lock or performing any SQLite / filesystem writes
  if (!(action === 'rollback' && documentId && targetVersion) && action !== 'reset') {
    const csValidation = validateComputerStatesInput(computerStates);
    if (!csValidation.valid) {
      return { status: 400, body: { error: csValidation.error } };
    }
  }

  return withWorkspaceMutationLock(async () => {
    // 1. Handle complete server-side workspace reset
    if (action === 'reset') {
      const db = getDatabase();
      db.exec(`
        DELETE FROM approvals;
        DELETE FROM agent_tasks;
        DELETE FROM evidence_records;
        DELETE FROM missions;
        DELETE FROM background_jobs;
        DELETE FROM document_revisions;
        DELETE FROM documents;
        DELETE FROM spaces;
      `);

      seedInitialSpaces(INITIAL_SPACES);

      const sandboxesRoot = path.join(STORAGE_DIR, 'sandboxes');
      if (fsSync.existsSync(sandboxesRoot)) {
        fsSync.rmSync(sandboxesRoot, { recursive: true, force: true });
      }
      fsSync.mkdirSync(sandboxesRoot, { recursive: true });

      const resetState = {
        agents: INITIAL_AGENTS,
        spaces: INITIAL_SPACES,
        computerStates: INITIAL_COMPUTER_STATES,
        messages: INITIAL_MESSAGES,
        settings: DEFAULT_LLM_SETTINGS,
        savedAt: new Date().toISOString(),
      };
      await writeFileNoFollow(STORAGE_DIR, 'workspace-state.json', JSON.stringify(resetState, null, 2), 0o600);

      logAuditEvent('WORKSPACE_RESET', 'Factory reset of workspace state, sandboxes, and database', 'success');

      return {
        status: 200,
        body: {
          success: true,
          message: 'Workspace successfully reset to factory defaults',
          state: resetState,
        },
      };
    }

    // 2. Handle document rollback to a previous version inside the serialized mutation lock
    if (action === 'rollback' && documentId && targetVersion) {
      const rolledBack = rollbackDocumentToVersion(documentId, targetVersion);
      return {
        status: 200,
        body: {
          success: true,
          message: `Successfully rolled back document to v${targetVersion}`,
          document: rolledBack,
        },
      };
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

    const opId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const savepointName = `nook_ws_sync_${opId}`;
    const backupDir = path.join(STORAGE_DIR, `.state_backup_${opId}`);
    const sandboxesRoot = path.join(STORAGE_DIR, 'sandboxes');
    const hasComputerStates = Boolean(computerStates && typeof computerStates === 'object');

    // Snapshot pre-transaction filesystem state for complete cross-store rollback on any failure
    fsSync.mkdirSync(backupDir, { recursive: true });
    const hadStateFile = fsSync.existsSync(STATE_FILE);
    if (hadStateFile) {
      fsSync.cpSync(STATE_FILE, path.join(backupDir, 'workspace-state.json'));
    }
    const hadSandboxes = fsSync.existsSync(sandboxesRoot);
    if (hasComputerStates && hadSandboxes) {
      fsSync.cpSync(sandboxesRoot, path.join(backupDir, 'sandboxes'), { recursive: true });
    }

    const db = getDatabase();
    let savepointOpen = false;
    try {
      // Step 1: Atomic no-follow temporary-file write + flush + same-directory rename for workspace-state.json
      // IMPORTANT: SQLite savepoint is NOT held open across async I/O or test failure hooks,
      // preventing rollback of concurrent unrelated database writes.
      const savedAt = new Date().toISOString();
      const serialized = JSON.stringify(
        scrubSensitiveData({
          agents,
          spaces,
          computerStates,
          messages,
          settings: sanitizedSettings,
          savedAt,
        }),
        null,
        2
      );

      await writeFileNoFollow(STORAGE_DIR, 'workspace-state.json', serialized, 0o600, {
        beforeRenameHook: options?.beforeRenameHook,
      });

      if (typeof options?.afterStateFileHook === 'function') {
        await options.afterStateFileHook({ stateFile: STATE_FILE });
      }

      // Step 2: Persist per-agent workspace files on durable server disk using strict realpath & atomic O_NOFOLLOW confinement
      if (hasComputerStates) {
        await ensureRealDirectoryWithin(STORAGE_DIR, sandboxesRoot);
        let sandboxFileIndex = 0;

        for (const [agentId, compState] of Object.entries<any>(computerStates)) {
          if (compState?.files && Array.isArray(compState.files)) {
            const agentDiskDir = path.join(sandboxesRoot, agentId, 'workspace');
            await ensureRealDirectoryWithin(sandboxesRoot, agentDiskDir);

            for (const file of compState.files) {
              if (file?.name && typeof file?.content === 'string') {
                await writeFileNoFollow(agentDiskDir, file.name, file.content);
                if (typeof options?.afterSandboxFileHook === 'function') {
                  await options.afterSandboxFileHook({
                    agentId,
                    fileName: file.name,
                    filePath: path.join(agentDiskDir, file.name),
                    fileIndex: sandboxFileIndex,
                  });
                }
                sandboxFileIndex += 1;
              }
            }
          }
        }
      }

      // Step 3: Now that all asynchronous filesystem writes and hooks succeeded, persist spaces and
      // documents into SQLite synchronously without yielding to the event loop.
      if (Array.isArray(spaces)) {
        db.exec(`SAVEPOINT ${savepointName};`);
        savepointOpen = true;

        const suppliedSpaceIds = new Set<string>();
        for (const space of spaces) {
          if (space?.id && space?.name) {
            suppliedSpaceIds.add(space.id);
            saveSpace({ id: space.id, name: space.name, icon: space.icon || 'folder' });

            const suppliedDocIds = new Set<string>();
            if (Array.isArray(space.pages)) {
              for (const page of space.pages) {
                if (page?.id && page?.title) {
                  suppliedDocIds.add(page.id);
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

            // Prune documents in this space that were deleted by the client so they stay deleted after reload
            const existingDocs = db
              .prepare(`SELECT id FROM documents WHERE space_id = ?`)
              .all(space.id) as Array<{ id: string }>;
            for (const existingDoc of existingDocs) {
              if (!suppliedDocIds.has(existingDoc.id)) {
                db.prepare(`DELETE FROM documents WHERE id = ?`).run(existingDoc.id);
              }
            }
          }
        }

        db.exec(`RELEASE SAVEPOINT ${savepointName};`);
        savepointOpen = false;
      }

      logAuditEvent('WORKSPACE_SYNC', 'Synchronized workspace state, spaces, and sandboxes', 'success');

      return {
        status: 200,
        body: {
          success: true,
          savedAt,
          storageDirectory: STORAGE_DIR,
        },
      };
    } catch (err: any) {
      // 1. Roll back SQLite savepoint if it was opened during the database phase
      if (savepointOpen) {
        try {
          db.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
          db.exec(`RELEASE SAVEPOINT ${savepointName};`);
        } catch {
          // ignore if savepoint already closed
        }
        savepointOpen = false;
      }

      // 2. Roll back workspace-state.json to exact pre-transaction state
      try {
        const backupStateFile = path.join(backupDir, 'workspace-state.json');
        if (hadStateFile && fsSync.existsSync(backupStateFile)) {
          const priorContent = fsSync.readFileSync(backupStateFile, 'utf8');
          await writeFileNoFollow(STORAGE_DIR, 'workspace-state.json', priorContent, 0o600);
        } else if (!hadStateFile && fsSync.existsSync(STATE_FILE)) {
          fsSync.rmSync(STATE_FILE, { force: true });
        }
      } catch {
        // best-effort fallback copy
        try {
          const backupStateFile = path.join(backupDir, 'workspace-state.json');
          if (hadStateFile && fsSync.existsSync(backupStateFile)) {
            fsSync.cpSync(backupStateFile, STATE_FILE, { force: true });
          }
        } catch {}
      }

      // 3. Roll back sandbox files and directories if computerStates was part of this transaction
      if (hasComputerStates) {
        try {
          if (fsSync.existsSync(sandboxesRoot)) {
            fsSync.rmSync(sandboxesRoot, { recursive: true, force: true });
          }
          const backupSandboxes = path.join(backupDir, 'sandboxes');
          if (hadSandboxes && fsSync.existsSync(backupSandboxes)) {
            fsSync.cpSync(backupSandboxes, sandboxesRoot, { recursive: true });
          }
        } catch {
          // ignore rollback cleanup error
        }
      }

      throw err;
    } finally {
      try {
        if (fsSync.existsSync(backupDir)) {
          fsSync.rmSync(backupDir, { recursive: true, force: true });
        }
      } catch {}
    }
  });
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
    const result = await persistWorkspaceStatePayload(payload);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
