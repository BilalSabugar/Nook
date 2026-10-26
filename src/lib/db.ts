import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const DB_PATH = path.join(STORAGE_DIR, 'nook.db');

let _dbInstance: DatabaseSync | null = null;

export function getDatabase(): DatabaseSync {
  if (_dbInstance) return _dbInstance;

  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);

  // Enable WAL mode for high performance concurrency
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Run migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target_space_id TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      single_use_token TEXT NOT NULL,
      decision_at TEXT,
      decision_reason TEXT,
      execution_result_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_approvals_agent ON approvals(agent_id);

    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      icon TEXT,
      author_agent_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      tags_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_documents_space ON documents(space_id);

    CREATE TABLE IF NOT EXISTS document_revisions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author_agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      change_summary TEXT,
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_revisions_doc ON document_revisions(document_id);

    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      steps_json TEXT NOT NULL DEFAULT '[]',
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON background_jobs(status);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      user_id TEXT,
      agent_id TEXT,
      ip TEXT,
      status TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
  `);

  _dbInstance = db;
  return db;
}

// ==========================================
// AUDIT LOGGING
// ==========================================
export function logAuditEvent(action: string, details: string, status: string = 'success', agentId?: string, ip?: string): void {
  try {
    const db = getDatabase();
    const id = `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, timestamp, action, details, user_id, agent_id, ip, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, new Date().toISOString(), action, details, 'single-user', agentId || null, ip || '127.0.0.1', status);
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// ==========================================
// APPROVALS REPOSITORY
// ==========================================
export interface DbApprovalRecord {
  id: string;
  agentId: string;
  agentName: string;
  type: 'run_command' | 'save_page' | 'mcp_action';
  title: string;
  description: string;
  targetSpaceId?: string;
  payload: {
    command?: string;
    pageTitle?: string;
    pageContent?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
  };
  status: 'pending' | 'approved' | 'declined' | 'consumed' | 'rolled_back';
  createdAt: string;
  expiresAt: string;
  singleUseToken: string;
  decisionAt?: string;
  decisionReason?: string;
  executionResult?: {
    success: boolean;
    executedAt: string;
    output?: string;
    exitCode?: number;
  };
}

export function createApproval(record: {
  id?: string;
  agentId: string;
  agentName: string;
  type: 'run_command' | 'save_page' | 'mcp_action';
  title: string;
  description?: string;
  targetSpaceId?: string;
  payload: Record<string, any>;
  ttlMs?: number;
}): DbApprovalRecord {
  const db = getDatabase();
  const id = record.id || `appr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const expiresAt = new Date(now + (record.ttlMs || 15 * 60 * 1000)).toISOString();

  const stmt = db.prepare(`
    INSERT INTO approvals (
      id, agent_id, agent_name, type, title, description, target_space_id,
      payload_json, status, created_at, expires_at, single_use_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    record.agentId,
    record.agentName,
    record.type,
    record.title,
    record.description || '',
    record.targetSpaceId || null,
    JSON.stringify(record.payload || {}),
    'pending',
    new Date(now).toISOString(),
    expiresAt,
    token
  );

  logAuditEvent('APPROVAL_CREATED', `Created approval ${id} for ${record.agentName} (${record.type})`, 'success', record.agentId);

  return {
    id,
    agentId: record.agentId,
    agentName: record.agentName,
    type: record.type,
    title: record.title,
    description: record.description || '',
    targetSpaceId: record.targetSpaceId,
    payload: record.payload,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt,
    singleUseToken: token,
  };
}

export function listApprovals(includeSecretTokens: boolean = false): DbApprovalRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`);
  const rows = stmt.all() as any[];

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    type: r.type,
    title: r.title,
    description: r.description || '',
    targetSpaceId: r.target_space_id || undefined,
    payload: JSON.parse(r.payload_json || '{}'),
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    singleUseToken: includeSecretTokens ? r.single_use_token : 'REDACTED',
    decisionAt: r.decision_at || undefined,
    decisionReason: r.decision_reason || undefined,
    executionResult: r.execution_result_json ? JSON.parse(r.execution_result_json) : undefined,
  }));
}

export function getApprovalById(id: string): DbApprovalRecord | null {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM approvals WHERE id = ?`);
  const r = stmt.get(id) as any;
  if (!r) return null;

  return {
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    type: r.type,
    title: r.title,
    description: r.description || '',
    targetSpaceId: r.target_space_id || undefined,
    payload: JSON.parse(r.payload_json || '{}'),
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    singleUseToken: r.single_use_token,
    decisionAt: r.decision_at || undefined,
    decisionReason: r.decision_reason || undefined,
    executionResult: r.execution_result_json ? JSON.parse(r.execution_result_json) : undefined,
  };
}

export function decideApproval(id: string, decision: 'approve' | 'decline', reason?: string): { success: boolean; error?: string; approval?: DbApprovalRecord } {
  const db = getDatabase();
  const approval = getApprovalById(id);
  if (!approval) {
    return { success: false, error: `Approval record ${id} not found.` };
  }

  if (approval.status !== 'pending') {
    return { success: false, error: `Approval is already in '${approval.status}' state.` };
  }

  if (Date.now() > Date.parse(approval.expiresAt)) {
    db.prepare(`UPDATE approvals SET status = 'declined', decision_reason = 'Expired' WHERE id = ?`).run(id);
    return { success: false, error: 'Approval request has expired.' };
  }

  const newStatus = decision === 'approve' ? 'approved' : 'declined';
  const decisionAt = new Date().toISOString();

  db.prepare(`
    UPDATE approvals
    SET status = ?, decision_at = ?, decision_reason = ?
    WHERE id = ? AND status = 'pending'
  `).run(newStatus, decisionAt, reason || null, id);

  logAuditEvent('APPROVAL_DECIDED', `Approval ${id} was ${newStatus}`, 'success', approval.agentId);

  const updated = getApprovalById(id);
  return { success: true, approval: updated || undefined };
}

/**
 * Concurrency-safe atomic consumption:
 * Strictly matches command and token. Updates status to 'consumed'.
 */
export function verifyAndConsumeApproval(
  id: string,
  token: string,
  expectedCommand?: string,
  expectedAgentId?: string
): { authorized: boolean; error?: string; approval?: DbApprovalRecord } {
  const db = getDatabase();
  const record = getApprovalById(id);

  if (!record) {
    return { authorized: false, error: `Approval record '${id}' does not exist.` };
  }

  if (record.status !== 'approved') {
    return { authorized: false, error: `Approval is in '${record.status}' state. Must be 'approved'.` };
  }

  // Token match
  if (!token || record.singleUseToken !== token) {
    return { authorized: false, error: 'Invalid or missing single-use authorization token.' };
  }

  // Agent match
  if (expectedAgentId && record.agentId !== expectedAgentId) {
    return { authorized: false, error: `Approval was issued for agent '${record.agentId}', not '${expectedAgentId}'.` };
  }

  // Exact command match
  if (expectedCommand && record.payload.command) {
    if (record.payload.command.trim() !== expectedCommand.trim()) {
      return {
        authorized: false,
        error: `Command mismatch: Approved command ('${record.payload.command.trim()}') does not match requested command ('${expectedCommand.trim()}').`,
      };
    }
  }

  // Check TTL
  if (Date.now() > Date.parse(record.expiresAt)) {
    db.prepare(`UPDATE approvals SET status = 'declined', decision_reason = 'Expired authorization' WHERE id = ?`).run(id);
    return { authorized: false, error: 'Authorization token has expired.' };
  }

  // Atomic consumption transition
  const result = db.prepare(`
    UPDATE approvals
    SET status = 'consumed'
    WHERE id = ? AND status = 'approved' AND single_use_token = ?
  `).run(id, token);

  if (result.changes === 0) {
    return { authorized: false, error: 'Approval token was already consumed or race condition detected.' };
  }

  logAuditEvent('APPROVAL_CONSUMED', `Approval ${id} consumed for command '${record.payload.command || record.type}'`, 'success', record.agentId);

  const consumed = getApprovalById(id);
  return { authorized: true, approval: consumed || undefined };
}

export function recordApprovalExecutionResult(id: string, result: { success: boolean; executedAt: string; output?: string; exitCode?: number }): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE approvals
    SET execution_result_json = ?
    WHERE id = ?
  `).run(JSON.stringify(result), id);
}

// ==========================================
// BACKGROUND JOBS WORKER REPOSITORY
// ==========================================
export interface DbBackgroundJob {
  id: string;
  agentId: string;
  taskType: 'research' | 'code_test' | 'doc_generation' | 'multi_agent_workflow';
  title: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  steps: {
    timestamp: string;
    step: string;
    tool?: string;
    output?: string;
  }[];
  result?: {
    summary: string;
    artifacts?: string[];
    citations?: string[];
  };
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export function enqueueJob(job: {
  agentId: string;
  taskType: 'research' | 'code_test' | 'doc_generation' | 'multi_agent_workflow';
  title: string;
  prompt: string;
}): DbBackgroundJob {
  const db = getDatabase();
  const id = `job-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const steps = [{ timestamp: now, step: 'Job enqueued in durable transactional SQLite queue' }];

  db.prepare(`
    INSERT INTO background_jobs (id, agent_id, task_type, title, prompt, status, progress, steps_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)
  `).run(id, job.agentId, job.taskType, job.title, job.prompt, JSON.stringify(steps), now);

  logAuditEvent('JOB_ENQUEUED', `Job ${id} (${job.taskType}) enqueued for ${job.agentId}`, 'success', job.agentId);

  return {
    id,
    agentId: job.agentId,
    taskType: job.taskType,
    title: job.title,
    prompt: job.prompt,
    status: 'queued',
    progress: 0,
    steps,
    createdAt: now,
  };
}

export function listJobs(): DbBackgroundJob[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM background_jobs ORDER BY created_at DESC`).all() as any[];

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    taskType: r.task_type,
    title: r.title,
    prompt: r.prompt || '',
    status: r.status,
    progress: r.progress,
    steps: JSON.parse(r.steps_json || '[]'),
    result: r.result_json ? JSON.parse(r.result_json) : undefined,
    error: r.error || undefined,
    createdAt: r.created_at,
    startedAt: r.started_at || undefined,
    completedAt: r.completed_at || undefined,
  }));
}

export function getJobById(id: string): DbBackgroundJob | null {
  const db = getDatabase();
  const r = db.prepare(`SELECT * FROM background_jobs WHERE id = ?`).get(id) as any;
  if (!r) return null;

  return {
    id: r.id,
    agentId: r.agent_id,
    taskType: r.task_type,
    title: r.title,
    prompt: r.prompt || '',
    status: r.status,
    progress: r.progress,
    steps: JSON.parse(r.steps_json || '[]'),
    result: r.result_json ? JSON.parse(r.result_json) : undefined,
    error: r.error || undefined,
    createdAt: r.created_at,
    startedAt: r.started_at || undefined,
    completedAt: r.completed_at || undefined,
  };
}

export function claimNextQueuedJob(): DbBackgroundJob | null {
  const db = getDatabase();
  // Find oldest queued job
  const next = db.prepare(`SELECT id FROM background_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`).get() as any;
  if (!next) return null;

  const now = new Date().toISOString();
  const res = db.prepare(`
    UPDATE background_jobs
    SET status = 'running', started_at = ?
    WHERE id = ? AND status = 'queued'
  `).run(now, next.id);

  if (res.changes === 0) return null;
  return getJobById(next.id);
}

export function updateJobProgress(
  id: string,
  progress: number,
  step?: { step: string; tool?: string; output?: string }
): void {
  const db = getDatabase();
  const existing = getJobById(id);
  if (!existing || existing.status === 'cancelled') return;

  const steps = existing.steps;
  if (step) {
    steps.push({
      timestamp: new Date().toISOString(),
      step: step.step,
      tool: step.tool,
      output: step.output,
    });
  }

  db.prepare(`
    UPDATE background_jobs
    SET progress = ?, steps_json = ?
    WHERE id = ? AND status = 'running'
  `).run(progress, JSON.stringify(steps), id);
}

export function completeJob(id: string, result: { summary: string; artifacts?: string[]; citations?: string[] }): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE background_jobs
    SET status = 'completed', progress = 100, result_json = ?, completed_at = ?
    WHERE id = ? AND status = 'running'
  `).run(JSON.stringify(result), now, id);

  logAuditEvent('JOB_COMPLETED', `Job ${id} completed`, 'success');
}

export function failJob(id: string, errorMessage: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE background_jobs
    SET status = 'failed', error = ?, completed_at = ?
    WHERE id = ?
  `).run(errorMessage, now, id);

  logAuditEvent('JOB_FAILED', `Job ${id} failed: ${errorMessage}`, 'error');
}

export function cancelJob(id: string): boolean {
  const db = getDatabase();
  const res = db.prepare(`
    UPDATE background_jobs
    SET status = 'cancelled'
    WHERE id = ? AND status IN ('queued', 'running')
  `).run(id);

  if (res.changes > 0) {
    logAuditEvent('JOB_CANCELLED', `Job ${id} cancelled by user`, 'success');
    return true;
  }
  return false;
}

// ==========================================
// SPACES & DOCUMENTS REVISION REPOSITORY
// ==========================================
export interface DbSpace {
  id: string;
  name: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbDocument {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  excerpt: string;
  icon: string;
  authorAgentId: string;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DbDocumentRevision {
  id: string;
  documentId: string;
  version: number;
  title: string;
  content: string;
  authorAgentId: string;
  createdAt: string;
  changeSummary?: string;
}

export function saveSpace(space: { id: string; name: string; icon: string }): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO spaces (id, name, icon, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, updated_at = excluded.updated_at
  `).run(space.id, space.name, space.icon, now, now);
}

export function listSpacesWithDocuments(): any[] {
  const db = getDatabase();
  const spaces = db.prepare(`SELECT * FROM spaces ORDER BY created_at ASC`).all() as any[];
  const docs = db.prepare(`SELECT * FROM documents ORDER BY updated_at DESC`).all() as any[];

  return spaces.map((s) => ({
    id: s.id,
    name: s.name,
    icon: s.icon,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    pages: docs
      .filter((d) => d.space_id === s.id)
      .map((d) => ({
        id: d.id,
        spaceId: d.space_id,
        title: d.title,
        content: d.content,
        excerpt: d.excerpt,
        icon: d.icon,
        authorAgentId: d.author_agent_id,
        version: d.version,
        tags: JSON.parse(d.tags_json || '[]'),
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      })),
  }));
}

export function saveDocumentWithRevision(doc: {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  excerpt?: string;
  icon?: string;
  authorAgentId: string;
  tags?: string[];
  changeSummary?: string;
}): DbDocument {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Check if document exists to increment version
  const existing = db.prepare(`SELECT version FROM documents WHERE id = ?`).get(doc.id) as any;
  const newVersion = existing ? existing.version + 1 : 1;

  // Transaction for atomic document update + revision log
  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Ensure space exists
    db.prepare(`
      INSERT INTO spaces (id, name, icon, created_at, updated_at)
      VALUES (?, 'General Space', 'folder', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(doc.spaceId, now, now);

    // 2. Upsert document
    db.prepare(`
      INSERT INTO documents (
        id, space_id, title, content, excerpt, icon, author_agent_id, version, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        excerpt = excluded.excerpt,
        version = excluded.version,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at
    `).run(
      doc.id,
      doc.spaceId,
      doc.title,
      doc.content,
      doc.excerpt || doc.content.slice(0, 150).replace(/[#*`_]/g, ''),
      doc.icon || 'file-text',
      doc.authorAgentId,
      newVersion,
      JSON.stringify(doc.tags || []),
      now,
      now
    );

    // 3. Log immutable revision
    const revId = `rev-${doc.id}-v${newVersion}-${Date.now()}`;
    db.prepare(`
      INSERT INTO document_revisions (
        id, document_id, version, title, content, author_agent_id, created_at, change_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revId,
      doc.id,
      newVersion,
      doc.title,
      doc.content,
      doc.authorAgentId,
      now,
      doc.changeSummary || `Version ${newVersion} created`
    );

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  logAuditEvent('DOCUMENT_SAVED', `Document '${doc.title}' (${doc.id}) saved at v${newVersion}`, 'success', doc.authorAgentId);

  return {
    id: doc.id,
    spaceId: doc.spaceId,
    title: doc.title,
    content: doc.content,
    excerpt: doc.excerpt || doc.content.slice(0, 150).replace(/[#*`_]/g, ''),
    icon: doc.icon || 'file-text',
    authorAgentId: doc.authorAgentId,
    version: newVersion,
    tags: doc.tags || [],
    createdAt: now,
    updatedAt: now,
  };
}

export function listDocumentRevisions(documentId: string): DbDocumentRevision[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM document_revisions
    WHERE document_id = ?
    ORDER BY version DESC
  `).all(documentId) as any[];

  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    version: r.version,
    title: r.title,
    content: r.content,
    authorAgentId: r.author_agent_id,
    createdAt: r.created_at,
    changeSummary: r.change_summary || undefined,
  }));
}

export function rollbackDocumentToVersion(documentId: string, targetVersion: number): DbDocument {
  const db = getDatabase();
  const rev = db.prepare(`
    SELECT * FROM document_revisions
    WHERE document_id = ? AND version = ?
  `).get(documentId, targetVersion) as any;

  if (!rev) {
    throw new Error(`Revision v${targetVersion} for document ${documentId} not found.`);
  }

  return saveDocumentWithRevision({
    id: documentId,
    spaceId: rev.document_id, // falls back in transaction
    title: rev.title,
    content: rev.content,
    authorAgentId: 'system-rollback',
    changeSummary: `Rolled back to version ${targetVersion}`,
  });
}
