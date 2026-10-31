import { NextRequest, NextResponse } from 'next/server.js';
import { validateApiRequest, unauthorizedResponse } from '../../../../lib/auth.ts';
import {
  importWorkspaceSnapshot,
  validateWorkspaceSnapshot,
  verifyDatabaseIntegrity,
  logAuditEvent,
  getDatabase,
  withWorkspaceMutationLock,
  SAFE_SNAPSHOT_ID_PATTERN,
  SAFE_SNAPSHOT_FILENAME_PATTERN,
} from '../../../../lib/db.ts';
import {
  WorkspaceSecurityError,
  ensureRealDirectoryWithin,
  writeFileNoFollow,
} from '../../../../lib/safe-workspace.mjs';
import type { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), '.nook_storage');

function assertNoSymlinksInTree(targetPath: string): void {
  if (!fs.existsSync(targetPath)) return;
  const st = fs.lstatSync(targetPath);
  if (st.isSymbolicLink()) {
    throw new WorkspaceSecurityError(`Symlink rejected in workspace storage path: ${targetPath}`);
  }
  if (st.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      assertNoSymlinksInTree(path.join(targetPath, entry));
    }
  }
}

/**
 * Coordinates atomic snapshot validation, staged filesystem restoration, and transactional
 * SQLite import. Guarantees that:
 * 1. All validation (schema, checksum, provenance signature, path/filename safety, symlink checks)
 *    completes BEFORE any live filesystem or SQLite mutation.
 * 2. Every imported agentId and filename is strictly confined within `<storageDir>/sandboxes/<agentId>/workspace`
 *    using `ensureRealDirectoryWithin` and `writeFileNoFollow`.
 * 3. Any failure in staging, SQLite commit, or post-stage hook rolls back both SQLite and the filesystem
 *    so prior state remains 100% unchanged.
 */
export async function restoreWorkspaceBundleAtomically(
  bundle: any,
  options?: {
    storageDir?: string;
    db?: DatabaseSync;
    conflictStrategy?: 'merge' | 'replace' | 'abort';
    requireSignature?: boolean;
    signingSecret?: string;
    /** Optional fault injection hook for testing atomic rollback between staging and commit. */
    beforeCommitHook?: () => void;
  }
) {
  return withWorkspaceMutationLock(async () => {
    const storageDir = options?.storageDir ? path.resolve(/*turbopackIgnore: true*/ options.storageDir) : DEFAULT_STORAGE_DIR;
    const db = options?.db || getDatabase();
    const conflictStrategy = options?.conflictStrategy || bundle?.conflictStrategy || 'merge';

  // 1. Preflight validation (zero side effects on disk or DB)
  const preflight = validateWorkspaceSnapshot(bundle, {
    requireSignature: options?.requireSignature ?? Boolean(bundle?.requireSignature),
    signingSecret: options?.signingSecret,
  });

  if (!preflight.valid) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: `Snapshot preflight validation failed: ${preflight.errors.join('; ')}`,
        validation: preflight,
      },
    };
  }

  // Ensure storage root exists and contains no symlinks in target paths
  if (!fs.existsSync(/*turbopackIgnore: true*/ storageDir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ storageDir, { recursive: true });
  }
  const stateFile = path.join(storageDir, 'workspace-state.json');
  const sandboxesRoot = path.join(storageDir, 'sandboxes');

  assertNoSymlinksInTree(stateFile);
  assertNoSymlinksInTree(sandboxesRoot);

  // If conflictStrategy === 'abort', verify no target sandbox files already exist on disk before staging
  if (conflictStrategy === 'abort' && bundle.workspace?.computerStates) {
    for (const [agentId, state] of Object.entries(bundle.workspace.computerStates)) {
      const files = (state as { files?: Array<{ name?: string }> })?.files || [];
      for (const file of files) {
        if (file?.name) {
          const existingFile = path.join(sandboxesRoot, agentId, 'workspace', file.name);
          if (fs.existsSync(existingFile)) {
            return {
              ok: false as const,
              status: 409,
              body: {
                error: `ConflictError: Sandbox file "${agentId}/${file.name}" already exists (conflictStrategy=abort)`,
                validation: preflight,
              },
            };
          }
        }
      }
    }
  }

  const opId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const stagingDir = path.join(storageDir, `.import_staging_${opId}`);
  const backupDir = path.join(storageDir, `.import_backup_${opId}`);

  try {
    // 2. Stage all filesystem writes inside an isolated staging directory first
    await ensureRealDirectoryWithin(storageDir, stagingDir);

    if (bundle.workspace && typeof bundle.workspace === 'object') {
      const stagedStatePayload = JSON.stringify(
        {
          ...bundle.workspace,
          importedAt: new Date().toISOString(),
        },
        null,
        2
      );
      await writeFileNoFollow(stagingDir, 'workspace-state.json', stagedStatePayload);

      if (bundle.workspace.computerStates && typeof bundle.workspace.computerStates === 'object') {
        const stagedSandboxesRoot = path.join(stagingDir, 'sandboxes');
        await ensureRealDirectoryWithin(stagingDir, stagedSandboxesRoot);

        for (const [agentId, computerState] of Object.entries(bundle.workspace.computerStates)) {
          if (
            !SAFE_SNAPSHOT_ID_PATTERN.test(agentId) ||
            agentId === '.' ||
            agentId === '..' ||
            agentId.includes('/') ||
            agentId.includes('\\')
          ) {
            throw new WorkspaceSecurityError(`Rejected unsafe agentId in computerStates: "${agentId}"`);
          }

          const stagedAgentWorkspace = path.join(stagedSandboxesRoot, agentId, 'workspace');
          await ensureRealDirectoryWithin(stagedSandboxesRoot, stagedAgentWorkspace);

          const cState = computerState as { files?: Array<{ name: string; content: string }> };
          if (Array.isArray(cState.files)) {
            for (const file of cState.files) {
              if (
                !file ||
                typeof file.name !== 'string' ||
                !SAFE_SNAPSHOT_FILENAME_PATTERN.test(file.name) ||
                file.name === '.' ||
                file.name === '..'
              ) {
                throw new WorkspaceSecurityError(`Rejected unsafe file name in computerStates["${agentId}"]: "${file?.name}"`);
              }
              if (typeof file.content === 'string') {
                await writeFileNoFollow(stagedAgentWorkspace, file.name, file.content);
              }
            }
          }
        }
      }
    }

    // 3. Create filesystem backup of live state before committing SQLite & swapping files
    fs.mkdirSync(backupDir, { recursive: true });
    const hadStateFile = fs.existsSync(stateFile);
    if (hadStateFile) {
      fs.cpSync(stateFile, path.join(backupDir, 'workspace-state.json'));
    }
    const hadSandboxes = fs.existsSync(sandboxesRoot);
    if (hadSandboxes) {
      fs.cpSync(sandboxesRoot, path.join(backupDir, 'sandboxes'), { recursive: true });
    }

    let savepointActive = false;
    const savepointName = `nook_atomic_restore_${opId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    try {
      // 4. Open outer SQLite savepoint spanning both database import and filesystem swap
      // so that if any filesystem write, hook, or integrity check fails, SQLite changes are rolled back too.
      db.exec(`SAVEPOINT ${savepointName};`);
      savepointActive = true;

      const serverRequiresSignature = process.env.NOOK_REQUIRE_SNAPSHOT_SIGNATURE === 'true';
      const effectiveRequireSignature =
        serverRequiresSignature || options?.requireSignature === true || Boolean(bundle?.requireSignature);

      const importStats = importWorkspaceSnapshot(bundle, db, {
        conflictStrategy,
        requireSignature: effectiveRequireSignature,
        signingSecret: options?.signingSecret,
      });

      if (typeof options?.beforeCommitHook === 'function') {
        await options.beforeCommitHook();
      }

      // 5. Apply staged filesystem changes into live storageDir using safe confinement
      if (bundle.workspace && typeof bundle.workspace === 'object') {
        const stagedStateFile = path.join(stagingDir, 'workspace-state.json');
        if (fs.existsSync(stagedStateFile)) {
          const content = fs.readFileSync(stagedStateFile, 'utf8');
          await writeFileNoFollow(storageDir, 'workspace-state.json', content);
        }

        if (conflictStrategy === 'replace' && fs.existsSync(sandboxesRoot)) {
          fs.rmSync(sandboxesRoot, { recursive: true, force: true });
        }

        if (bundle.workspace.computerStates && typeof bundle.workspace.computerStates === 'object') {
          await ensureRealDirectoryWithin(storageDir, sandboxesRoot);
          for (const [agentId, computerState] of Object.entries(bundle.workspace.computerStates)) {
            const liveAgentWorkspace = path.join(sandboxesRoot, agentId, 'workspace');
            await ensureRealDirectoryWithin(sandboxesRoot, liveAgentWorkspace);
            const cState = computerState as { files?: Array<{ name: string; content: string }> };
            if (Array.isArray(cState.files)) {
              for (const file of cState.files) {
                if (file?.name && typeof file.content === 'string') {
                  await writeFileNoFollow(liveAgentWorkspace, file.name, file.content);
                }
              }
            }
          }
        }
      }

      // 6. Verify physical database & foreign-key integrity prior to committing the outer savepoint
      const integrity = verifyDatabaseIntegrity(db);
      if (!integrity.healthy) {
        throw new Error(`Database integrity check failed post-import: ${integrity.integrityCheck}`);
      }

      // 7. Commit outer SQLite savepoint now that both SQLite and filesystem changes have succeeded
      db.exec(`RELEASE SAVEPOINT ${savepointName};`);
      savepointActive = false;

      return {
        ok: true as const,
        status: 200,
        body: {
          status: 'success',
          message: 'Workspace snapshot restored atomically across SQLite and sandbox filesystem.',
          conflictStrategy,
          ...importStats,
          integrity,
        },
      };
    } catch (commitErr: unknown) {
      // Roll back uncommitted SQLite mutations inside outer savepoint
      if (savepointActive) {
        try {
          db.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
          db.exec(`RELEASE SAVEPOINT ${savepointName};`);
        } catch {
          // ignore if savepoint already closed
        }
        savepointActive = false;
      }

      // Roll back live filesystem from backup
      if (hadStateFile && fs.existsSync(path.join(backupDir, 'workspace-state.json'))) {
        fs.cpSync(path.join(backupDir, 'workspace-state.json'), stateFile, { force: true });
      } else if (!hadStateFile && fs.existsSync(stateFile)) {
        fs.rmSync(stateFile, { force: true });
      }

      if (fs.existsSync(sandboxesRoot)) {
        fs.rmSync(sandboxesRoot, { recursive: true, force: true });
      }
      if (hadSandboxes && fs.existsSync(path.join(backupDir, 'sandboxes'))) {
        fs.cpSync(path.join(backupDir, 'sandboxes'), sandboxesRoot, { recursive: true });
      }

      throw commitErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to import workspace snapshot';
    const isConflict = message.includes('ConflictError:');
    return {
      ok: false as const,
      status: isConflict ? 409 : 400,
      body: {
        error: message,
        validation: preflight,
      },
    };
  } finally {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  }
  });
}

export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error, auth.status);
  }

  try {
    const bundle = await req.json();

    if (!bundle || (bundle.schemaVersion !== 1 && bundle.schemaVersion !== 2)) {
      return NextResponse.json(
        { error: 'Invalid or unsupported Nook workspace bundle. Expected schemaVersion 1 or 2.' },
        { status: 400 }
      );
    }

    // Dry-run preflight validation support (?dryRun=true or bundle.dryRun === true)
    const isDryRun = req.nextUrl.searchParams.get('dryRun') === 'true' || bundle.dryRun === true;
    if (isDryRun) {
      const serverRequiresSignature = process.env.NOOK_REQUIRE_SNAPSHOT_SIGNATURE === 'true';
      const effectiveRequireSignature =
        serverRequiresSignature || Boolean(bundle.requireSignature);
      const validation = validateWorkspaceSnapshot(bundle, {
        requireSignature: effectiveRequireSignature,
      });
      return NextResponse.json(
        {
          status: validation.valid ? 'valid' : 'invalid',
          dryRun: true,
          validation,
        },
        { status: validation.valid ? 200 : 400 }
      );
    }

    const result = await restoreWorkspaceBundleAtomically(bundle);
    if (!result.ok) {
      logAuditEvent('WORKSPACE_IMPORT_REJECTED', result.body.error, 'failed');
      return NextResponse.json(result.body, { status: result.status });
    }

    logAuditEvent(
      'WORKSPACE_IMPORT',
      `Imported workspace bundle from ${bundle.exportedAt || 'unknown date'} (Spaces: ${result.body.importedSpacesCount}, Docs: ${result.body.importedDocsCount}, Revisions: ${result.body.importedRevisionsCount}, Missions: ${result.body.importedMissionsCount})`,
      'success'
    );

    return NextResponse.json(result.body);
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json(
      { error: error.message || 'Failed to import workspace snapshot' },
      { status: 500 }
    );
  }
}
