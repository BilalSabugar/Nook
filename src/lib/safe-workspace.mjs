/**
 * Filesystem-boundary primitives for task workspaces.
 * String sanitisation alone cannot stop symlink / hardlink redirection, so these helpers
 * enforce the boundary at the filesystem layer (lstat walk + O_NOFOLLOW + fstat checks).
 */
import fs from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class WorkspaceSecurityError extends Error {
  constructor(message, code = 'WORKSPACE_VIOLATION') {
    super(message);
    this.name = 'WorkspaceSecurityError';
    this.code = code;
  }
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Creates `target` (inside `root`) segment by segment, refusing symlinks and non-directories.
 * Returns the verified real path.
 */
export async function ensureRealDirectoryWithin(root, target, mode = 0o700) {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(target);
  if (!isInside(absRoot, absTarget)) {
    throw new WorkspaceSecurityError('Path escapes workspace root', 'PATH_ESCAPE');
  }
  await fs.mkdir(absRoot, { recursive: true, mode });
  const realRoot = await fs.realpath(absRoot);

  const segments = path.relative(absRoot, absTarget).split(path.sep).filter(Boolean);
  let current = absRoot;
  for (const seg of segments) {
    current = path.join(current, seg);
    let st = await fs.lstat(current).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
    if (!st) {
      await fs.mkdir(current, { mode }).catch((e) => {
        if (e.code !== 'EEXIST') throw e;
      });
      st = await fs.lstat(current);
    }
    if (st.isSymbolicLink()) {
      throw new WorkspaceSecurityError(`Symbolic link rejected at workspace boundary: ${seg}`, 'SYMLINK_REJECTED');
    }
    if (!st.isDirectory()) {
      throw new WorkspaceSecurityError(`Workspace segment is not a directory: ${seg}`, 'NOT_A_DIRECTORY');
    }
  }
  const real = await fs.realpath(absTarget);
  if (!isInside(realRoot, real)) {
    throw new WorkspaceSecurityError('Resolved workspace escapes root', 'PATH_ESCAPE');
  }
  return real;
}

/** Deletes every symlink below `dir` without ever following one. Returns the number removed. */
export async function removeSymlinksInTree(dir, { maxEntries = 20000, maxDepth = 32 } = {}) {
  let removed = 0;
  let seen = 0;
  async function walk(current, depth) {
    if (depth > maxDepth) throw new WorkspaceSecurityError('Workspace tree too deep', 'TREE_TOO_DEEP');
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (++seen > maxEntries) throw new WorkspaceSecurityError('Workspace tree too large', 'TREE_TOO_LARGE');
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        await fs.unlink(full);
        removed++;
      } else if (entry.isDirectory()) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(dir, 0);
  return removed;
}

/**
 * Writes a file inside `dir` atomically without following symlinks and refusing hard-linked targets:
 * 1. Verifies `dir` is a real directory (not a symlink) and `target` (if existing) is a regular, non-symlink, non-hardlinked file.
 * 2. Opens a unique same-directory temporary file with `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW`.
 * 3. Writes `content` and flushes (`handle.sync()`) to physical storage before closing the descriptor.
 * 4. Re-verifies `lstat(target)` immediately prior to atomic same-directory `fs.rename(tmpPath, target)`.
 * 5. Cleans up `tmpPath` if any step or optional `options.beforeRenameHook` throws, leaving the original `target` completely untouched.
 */
export async function writeFileNoFollow(dir, name, content, mode = 0o600, options = {}) {
  if (!name || name !== path.basename(name) || name === '.' || name === '..') {
    throw new WorkspaceSecurityError('Invalid file name', 'BAD_NAME');
  }
  const dirStat = await fs.lstat(dir).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  if (!dirStat) {
    throw new WorkspaceSecurityError(`Target directory does not exist: ${dir}`, 'NOT_A_DIRECTORY');
  }
  if (dirStat.isSymbolicLink()) {
    throw new WorkspaceSecurityError(`Symbolic link rejected on directory: ${dir}`, 'SYMLINK_REJECTED');
  }
  if (!dirStat.isDirectory()) {
    throw new WorkspaceSecurityError(`Target parent is not a directory: ${dir}`, 'NOT_A_DIRECTORY');
  }

  const target = path.join(dir, name);
  const verifyTargetStat = async () => {
    const pre = await fs.lstat(target).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
    if (pre) {
      if (pre.isSymbolicLink()) {
        throw new WorkspaceSecurityError(`Symbolic link rejected: ${name}`, 'SYMLINK_REJECTED');
      }
      if (!pre.isFile()) {
        throw new WorkspaceSecurityError(`Not a regular file: ${name}`, 'NOT_A_FILE');
      }
      if (pre.nlink > 1) {
        throw new WorkspaceSecurityError(`Hard-linked file rejected: ${name}`, 'HARDLINK_REJECTED');
      }
    }
  };

  await verifyTargetStat();

  const nonce = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const tmpName = `.${name}.${nonce}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  const flags = fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | (fsc.O_NOFOLLOW || 0);

  let handle;
  try {
    try {
      handle = await fs.open(tmpPath, flags, mode);
    } catch (e) {
      if (e.code === 'ELOOP') {
        throw new WorkspaceSecurityError(`Symbolic link rejected: ${tmpName}`, 'SYMLINK_REJECTED');
      }
      throw e;
    }

    try {
      const st = await handle.stat();
      if (!st.isFile()) throw new WorkspaceSecurityError(`Not a regular file: ${tmpName}`, 'NOT_A_FILE');
      if (st.nlink > 1) throw new WorkspaceSecurityError(`Hard-linked file rejected: ${tmpName}`, 'HARDLINK_REJECTED');
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (typeof options?.beforeRenameHook === 'function') {
      await options.beforeRenameHook({ tmpPath, target });
    }

    // Re-verify target immediately before same-directory atomic replacement
    await verifyTargetStat();
    await fs.rename(tmpPath, target);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export const writeFileAtomicNoFollow = writeFileNoFollow;
