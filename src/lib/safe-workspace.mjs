/**
 * Filesystem-boundary primitives for task workspaces.
 * String sanitisation alone cannot stop symlink / hardlink redirection, so these helpers
 * enforce the boundary at the filesystem layer (lstat walk + O_NOFOLLOW + fstat checks).
 */
import fs from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import path from 'node:path';

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
 * Writes a file inside `dir` without following symlinks and refusing hard-linked targets.
 * Does not truncate until the opened descriptor has been verified.
 */
export async function writeFileNoFollow(dir, name, content, mode = 0o600) {
  if (!name || name !== path.basename(name) || name === '.' || name === '..') {
    throw new WorkspaceSecurityError('Invalid file name', 'BAD_NAME');
  }
  const target = path.join(dir, name);
  const pre = await fs.lstat(target).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  if (pre && pre.isSymbolicLink()) {
    throw new WorkspaceSecurityError(`Symbolic link rejected: ${name}`, 'SYMLINK_REJECTED');
  }
  const flags = fsc.O_WRONLY | fsc.O_CREAT | (fsc.O_NOFOLLOW || 0);
  let handle;
  try {
    handle = await fs.open(target, flags, mode);
  } catch (e) {
    if (e.code === 'ELOOP') {
      throw new WorkspaceSecurityError(`Symbolic link rejected: ${name}`, 'SYMLINK_REJECTED');
    }
    throw e;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new WorkspaceSecurityError(`Not a regular file: ${name}`, 'NOT_A_FILE');
    if (st.nlink > 1) throw new WorkspaceSecurityError(`Hard-linked file rejected: ${name}`, 'HARDLINK_REJECTED');
    await handle.truncate(0);
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}
