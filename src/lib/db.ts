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
  applySchema(db);

  _dbInstance = db;
  return db;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/** Creates / migrates the full Nook schema on any SQLite handle (used for the live DB and restore targets). */
export function applySchema(db: DatabaseSync): void {
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

    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_agents_json TEXT NOT NULL,
      milestones_json TEXT NOT NULL,
      budget_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      assigned_agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      dependencies_json TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'medium',
      inputs_json TEXT DEFAULT '{}',
      outputs_json TEXT DEFAULT '{}',
      observations_json TEXT NOT NULL DEFAULT '[]',
      verification_json TEXT,
      approval_id TEXT,
      approval_token TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_mission ON agent_tasks(mission_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status);

    CREATE TABLE IF NOT EXISTS evidence_records (
      id TEXT PRIMARY KEY,
      mission_id TEXT,
      task_id TEXT,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_mission ON evidence_records(mission_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence_records(task_id);

    CREATE TABLE IF NOT EXISTS worker_leases (
      resource_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      fencing_token INTEGER NOT NULL DEFAULT 1,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leases_expires ON worker_leases(expires_at);
  `);

  ensureColumn(db, 'approvals', 'consumed_task_id', 'TEXT');
  ensureColumn(db, 'approvals', 'ticket_issued_at', 'TEXT');
  ensureColumn(db, 'background_jobs', 'updated_at', 'TEXT');
  ensureColumn(db, 'background_jobs', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'background_jobs', 'side_effect_state', 'TEXT');
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
    taskId?: string;
    workspace?: string;
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

export type RedactedApprovalRecord = Omit<DbApprovalRecord, 'singleUseToken'>;

interface ApprovalRow {
  id: string;
  agent_id: string;
  agent_name: string;
  type: 'run_command' | 'save_page' | 'mcp_action';
  title: string;
  description?: string;
  target_space_id?: string;
  payload_json: string;
  status: 'pending' | 'approved' | 'declined' | 'consumed' | 'rolled_back';
  created_at: string;
  expires_at: string;
  single_use_token: string;
  decision_at?: string;
  decision_reason?: string;
  execution_result_json?: string;
}

interface JobRow {
  id: string;
  agent_id: string;
  task_type: 'research' | 'code_test' | 'doc_generation' | 'multi_agent_workflow';
  title: string;
  prompt?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  steps_json?: string;
  result_json?: string;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

interface SpaceRow {
  id: string;
  name: string;
  icon?: string;
  created_at: string;
  updated_at: string;
}

interface DocumentRow {
  id: string;
  space_id: string;
  title: string;
  content: string;
  excerpt?: string;
  icon?: string;
  author_agent_id: string;
  version: number;
  tags_json?: string;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  id: string;
  document_id: string;
  version: number;
  title: string;
  content: string;
  author_agent_id: string;
  created_at: string;
  change_summary?: string;
}

interface MissionRow {
  id: string;
  title: string;
  objective: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  assigned_agents_json?: string;
  milestones_json?: string;
  budget_json?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

interface AgentTaskRow {
  id: string;
  mission_id: string;
  title: string;
  goal: string;
  assigned_agent_id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'requires_approval';
  dependencies_json?: string;
  priority: 'low' | 'medium' | 'high';
  inputs_json?: string;
  outputs_json?: string;
  observations_json?: string;
  verification_json?: string;
  approval_id?: string;
  approval_token?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

interface EvidenceRow {
  id: string;
  mission_id?: string;
  task_id?: string;
  agent_id: string;
  agent_name: string;
  timestamp: string;
  action_type: 'human_approval' | 'model_call' | 'tool_selection' | 'tool_exec' | 'browser_visit' | 'file_write' | 'shell_exec' | 'verification';
  summary: string;
  details_json?: string;
  status: string;
}

interface WorkerLeaseRow {
  resource_id: string;
  owner_id: string;
  fencing_token: number;
  acquired_at: string;
  expires_at: string;
}

export function redactApproval(record: DbApprovalRecord): RedactedApprovalRecord;
export function redactApproval(record: undefined): undefined;
export function redactApproval(record?: DbApprovalRecord): RedactedApprovalRecord | undefined;
export function redactApproval(record?: DbApprovalRecord): RedactedApprovalRecord | undefined {
  if (!record) return undefined;
  const { singleUseToken: _, ...rest } = record;
  return rest;
}

export function createApproval(record: {
  id?: string;
  agentId: string;
  agentName: string;
  type: 'run_command' | 'save_page' | 'mcp_action';
  title: string;
  description?: string;
  targetSpaceId?: string;
  payload: Record<string, unknown>;
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

export function listApprovals(includeSecretTokens: boolean = false, db: DatabaseSync = getDatabase()): DbApprovalRecord[] {
  const stmt = db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC`);
  const rows = stmt.all() as unknown as ApprovalRow[];

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
  const r = stmt.get(id) as unknown as ApprovalRow | undefined;
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
  expectedAgentId?: string,
  taskId?: string
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

  // Atomic consumption transition; binds the approval to exactly one task
  const result = db.prepare(`
    UPDATE approvals
    SET status = 'consumed', consumed_task_id = ?
    WHERE id = ? AND status = 'approved' AND single_use_token = ?
  `).run(taskId || null, id, token);

  if (result.changes === 0) {
    return { authorized: false, error: 'Approval token was already consumed or race condition detected.' };
  }

  logAuditEvent('APPROVAL_CONSUMED', `Approval ${id} consumed for command '${record.payload.command || record.type}'`, 'success', record.agentId);

  const consumed = getApprovalById(id);
  return { authorized: true, approval: consumed || undefined };
}

/**
 * Atomically claims an approval for exactly ONE execution-ticket issuance.
 * - 'approved'  -> consumed + bound to taskId + ticket issued (single statement)
 * - 'consumed'  -> only if it was consumed for this very task and no ticket was issued yet
 * Any further attempt (replay, other task, retry) is denied.
 */
export function claimApprovalForTicket(id: string, taskId: string): { ok: boolean; error?: string } {
  const db = getDatabase();
  const now = new Date().toISOString();
  const fromApproved = db.prepare(`
    UPDATE approvals
    SET status = 'consumed', consumed_task_id = ?, ticket_issued_at = ?
    WHERE id = ? AND status = 'approved' AND ticket_issued_at IS NULL
  `).run(taskId, now, id);
  if (Number(fromApproved.changes) > 0) return { ok: true };

  const fromConsumed = db.prepare(`
    UPDATE approvals
    SET ticket_issued_at = ?
    WHERE id = ? AND status = 'consumed' AND consumed_task_id = ? AND ticket_issued_at IS NULL
  `).run(now, id, taskId);
  if (Number(fromConsumed.changes) > 0) return { ok: true };

  return { ok: false, error: 'Approval already used for an execution attempt (single-use) or bound to a different task.' };
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
  const rows = db.prepare(`SELECT * FROM background_jobs ORDER BY created_at DESC`).all() as unknown as JobRow[];

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
  const r = db.prepare(`SELECT * FROM background_jobs WHERE id = ?`).get(id) as unknown as JobRow | undefined;
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
  const next = db.prepare(`SELECT id FROM background_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`).get() as unknown as { id: string } | undefined;
  if (!next) return null;

  const now = new Date().toISOString();
  const res = db.prepare(`
    UPDATE background_jobs
    SET status = 'running', started_at = ?, updated_at = ?
    WHERE id = ? AND status = 'queued'
  `).run(now, now, next.id);

  if (res.changes === 0) return null;
  return getJobById(next.id);
}

export function markJobSideEffectStarted(jobId: string): boolean {
  const db = getDatabase();
  const now = new Date().toISOString();
  const res = db.prepare(`
    UPDATE background_jobs
    SET side_effect_state = 'started', updated_at = ?
    WHERE id = ? AND status = 'running' AND side_effect_state IS NULL
  `).run(now, jobId);
  return Number(res.changes) > 0;
}

export function markJobSideEffectFinished(jobId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE background_jobs
    SET side_effect_state = 'finished', updated_at = ?
    WHERE id = ?
  `).run(now, jobId);
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

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE background_jobs
    SET progress = ?, steps_json = ?, updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(progress, JSON.stringify(steps), now, id);
}

export function completeJob(id: string, result: { summary: string; artifacts?: string[]; citations?: string[] }): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE background_jobs
    SET status = 'completed', progress = 100, result_json = ?, completed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(JSON.stringify(result), now, now, id);

  logAuditEvent('JOB_COMPLETED', `Job ${id} completed`, 'success');
}

export function failJob(id: string, errorMessage: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE background_jobs
    SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(errorMessage, now, now, id);

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

export function saveSpace(space: { id: string; name: string; icon?: string }): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO spaces (id, name, icon, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, updated_at = excluded.updated_at
  `).run(space.id, space.name, space.icon || 'folder', now, now);
}

export function listSpacesWithDocuments(): Array<{ id: string; name: string; icon: string; createdAt: string; updatedAt: string; pages: Array<{ id: string; spaceId: string; title: string; content: string; excerpt?: string; icon?: string; authorAgentId: string; version: number; tags: string[]; createdAt: string; updatedAt: string }> }> {
  const db = getDatabase();
  const spaces = db.prepare(`SELECT * FROM spaces ORDER BY created_at ASC`).all() as unknown as SpaceRow[];
  const docs = db.prepare(`SELECT * FROM documents ORDER BY updated_at DESC`).all() as unknown as DocumentRow[];

  return spaces.map((s) => ({
    id: s.id,
    name: s.name,
    icon: s.icon || 'folder',
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

export function getDocumentById(id: string): DbDocument | null {
  const db = getDatabase();
  const d = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as unknown as DocumentRow | undefined;
  if (!d) return null;
  return {
    id: d.id,
    spaceId: d.space_id,
    title: d.title,
    content: d.content,
    excerpt: d.excerpt || '',
    icon: d.icon || 'file-text',
    authorAgentId: d.author_agent_id,
    version: d.version,
    tags: JSON.parse(d.tags_json || '[]'),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

export function seedInitialSpaces(
  spacesToSeed?: Array<{ id: string; name: string; icon?: string; pages?: any[] }>,
  db: DatabaseSync = getDatabase()
): Array<{ id: string; name: string }> {
  const existingCount = db.prepare(`SELECT COUNT(*) as count FROM spaces`).get() as { count: number };
  if (existingCount.count > 0) return [];

  let toSeed = spacesToSeed;
  if (!toSeed || !Array.isArray(toSeed) || toSeed.length === 0) {
    toSeed = [
      { id: 'space-general', name: 'General', icon: 'folder', pages: [] },
      { id: 'space-missions', name: 'Mission Log', icon: 'crosshair', pages: [] },
      { id: 'space-knowledge', name: 'Knowledge Base', icon: 'book', pages: [] },
    ];
  }

  const now = new Date().toISOString();
  for (const s of toSeed) {
    db.prepare(`INSERT OR IGNORE INTO spaces (id, name, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
      s.id,
      s.name,
      s.icon || 'folder',
      now,
      now
    );
    for (const p of s.pages || []) {
      db.prepare(`
        INSERT OR IGNORE INTO documents (
          id, space_id, title, content, excerpt, icon, author_agent_id, version, tags_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.id,
        s.id,
        p.title,
        p.content,
        p.excerpt || null,
        p.icon || 'file-text',
        p.authorAgentId || 'system',
        p.version || 1,
        JSON.stringify(p.tags || []),
        p.createdAt || now,
        p.updatedAt || now
      );
    }
  }

  return toSeed.map((s) => ({ id: s.id, name: s.name }));
}

export function saveDocumentWithRevision(doc: {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  excerpt?: string;
  icon?: string;
  authorAgentId?: string;
  tags?: string[];
  changeSummary?: string;
}): DbDocument {
  const db = getDatabase();
  const now = new Date().toISOString();
  const authorAgentId = doc.authorAgentId || 'user';

  // Check if document exists
  const existing = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(doc.id) as unknown as DocumentRow | undefined;

  // Idempotency & bloat guard: If document exists with identical title and content, do not bump version or create redundant revision
  if (existing && existing.title === doc.title && existing.content === doc.content) {
    db.prepare(`
      UPDATE documents SET
        excerpt = ?,
        icon = ?,
        tags_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      doc.excerpt || existing.excerpt || null,
      doc.icon || existing.icon || 'file-text',
      JSON.stringify(doc.tags || JSON.parse(existing.tags_json || '[]')),
      now,
      doc.id
    );
    return getDocumentById(doc.id)!;
  }

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
      authorAgentId,
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
      authorAgentId,
      now,
      doc.changeSummary || `Version ${newVersion} created`
    );

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  logAuditEvent('DOCUMENT_SAVED', `Document '${doc.title}' (${doc.id}) saved at v${newVersion}`, 'success', authorAgentId);

  const savedDoc: DbDocument = {
    id: doc.id,
    spaceId: doc.spaceId,
    title: doc.title,
    content: doc.content,
    excerpt: doc.excerpt || doc.content.slice(0, 150).replace(/[#*`_]/g, ''),
    icon: doc.icon || 'file-text',
    authorAgentId,
    version: newVersion,
    tags: doc.tags || [],
    createdAt: now,
    updatedAt: now,
  };

  notifyDocumentListeners(`nook://spaces/${doc.spaceId}/documents/${doc.id}`, savedDoc);

  return savedDoc;
}

type DocumentUpdateListener = (uri: string, doc: DbDocument) => void;
const _documentUpdateListeners = new Set<DocumentUpdateListener>();

export function onDocumentUpdated(listener: DocumentUpdateListener): () => void {
  _documentUpdateListeners.add(listener);
  return () => {
    _documentUpdateListeners.delete(listener);
  };
}

function notifyDocumentListeners(uri: string, doc: DbDocument): void {
  for (const listener of _documentUpdateListeners) {
    try {
      listener(uri, doc);
    } catch {
      // ignore listener errors
    }
  }
}

export function listDocumentRevisions(documentId: string): DbDocumentRevision[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM document_revisions
    WHERE document_id = ?
    ORDER BY version DESC
  `).all(documentId) as unknown as RevisionRow[];

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
  `).get(documentId, targetVersion) as unknown as RevisionRow | undefined;

  if (!rev) {
    throw new Error(`Revision v${targetVersion} for document ${documentId} not found.`);
  }

  // Look up current space for document so it is not moved into a phantom space
  const currentDoc = db.prepare(`SELECT space_id FROM documents WHERE id = ?`).get(documentId) as unknown as DocumentRow | undefined;
  const currentSpaceId = currentDoc?.space_id || 'default-space';

  return saveDocumentWithRevision({
    id: documentId,
    spaceId: currentSpaceId,
    title: rev.title,
    content: rev.content,
    authorAgentId: 'system-rollback',
    changeSummary: `Rolled back to version ${targetVersion}`,
  });
}

// ==========================================
// MISSIONS & TASKS REPOSITORY (Stages 2 & 3)
// ==========================================
export interface DbMission {
  id: string;
  title: string;
  objective: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  assignedAgents: string[];
  milestones: {
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    taskIds: string[];
  }[];
  budget?: {
    maxToolCalls?: number;
    usedToolCalls?: number;
    maxDurationMs?: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  tasks?: DbAgentTask[];
}

export interface DbAgentTask {
  id: string;
  missionId: string;
  title: string;
  goal: string;
  assignedAgentId: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'requires_approval';
  dependencies: string[];
  priority: 'low' | 'medium' | 'high';
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  observations: {
    timestamp: string;
    tool?: string;
    input?: unknown;
    output?: string;
    status: 'success' | 'warning' | 'error';
  }[];
  verification?: {
    verified: boolean;
    verifiedAt?: string;
    method: 'test_exit_code' | 'citation_validation' | 'schema_check' | 'human_approval' | 'structured_test_runner';
    details: string;
  };
  approvalId?: string;
  approvalToken?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export function createMission(mission: {
  id?: string;
  title: string;
  objective: string;
  priority?: 'low' | 'medium' | 'high';
  assignedAgents?: string[];
  milestones?: { id: string; title: string; status: 'pending' | 'in_progress' | 'completed' | 'failed'; taskIds: string[] }[];
  budget?: { maxToolCalls?: number; usedToolCalls?: number; maxDurationMs?: number };
}): DbMission {
  const db = getDatabase();
  const id = mission.id || `msn-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  const assignedAgents = mission.assignedAgents || ['agent-aura', 'agent-scout', 'agent-quill', 'agent-cipher'];
  const milestones = mission.milestones || [];
  const cleanTitle = scrubSensitiveData(mission.title);
  const cleanObjective = scrubSensitiveData(mission.objective);
  const cleanBudget = scrubSensitiveData(mission.budget || { maxToolCalls: 20, usedToolCalls: 0 });

  db.prepare(`
    INSERT INTO missions (
      id, title, objective, status, priority, assigned_agents_json, milestones_json, budget_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    cleanTitle,
    cleanObjective,
    mission.priority || 'medium',
    JSON.stringify(assignedAgents),
    JSON.stringify(milestones),
    JSON.stringify(cleanBudget),
    now,
    now
  );

  logAuditEvent('MISSION_CREATED', `Mission '${cleanTitle}' (${id}) created`, 'success', 'agent-aura');

  return {
    id,
    title: cleanTitle,
    objective: cleanObjective,
    status: 'draft',
    priority: mission.priority || 'medium',
    assignedAgents,
    milestones,
    budget: cleanBudget,
    createdAt: now,
    updatedAt: now,
  };
}

export function getMissionById(id: string): DbMission | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM missions WHERE id = ?`).get(id) as unknown as MissionRow | undefined;
  if (!row) return null;

  const tasks = listTasksForMission(id);

  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    status: row.status as DbMission['status'],
    priority: row.priority as DbMission['priority'],
    assignedAgents: JSON.parse(row.assigned_agents_json || '[]'),
    milestones: JSON.parse(row.milestones_json || '[]'),
    budget: row.budget_json ? JSON.parse(row.budget_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
    tasks,
  };
}

export function listMissions(): DbMission[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM missions ORDER BY created_at DESC`).all() as unknown as MissionRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    objective: row.objective,
    status: row.status as DbMission['status'],
    priority: row.priority as DbMission['priority'],
    assignedAgents: JSON.parse(row.assigned_agents_json || '[]'),
    milestones: JSON.parse(row.milestones_json || '[]'),
    budget: row.budget_json ? JSON.parse(row.budget_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
  }));
}

export function updateMissionStatus(
  id: string,
  status: 'draft' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const completedAt = status === 'completed' || status === 'failed' || status === 'cancelled' ? now : null;

  db.prepare(`
    UPDATE missions
    SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `).run(status, now, completedAt, id);

  logAuditEvent('MISSION_STATUS', `Mission ${id} status updated to ${status}`, 'success', 'agent-aura');
}

/**
 * Redacts embedded API keys, bearer tokens, and configured runtime secrets inside arbitrary text.
 */
export function redactSecretsInText(input: string): string {
  if (!input || typeof input !== 'string') return input;
  let out = input;

  // 1. Redact provider API key patterns (both standalone and embedded in text/headers/URLs)
  // Negative lookbehind (?<![A-Za-z0-9_-]) ensures words like "task-..." or "tsk-..." never match "sk-..."
  out = out.replace(/(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED_GEMINI_KEY]');
  out = out.replace(/(?<![A-Za-z0-9_-])sk-ant-[0-9A-Za-z_-]{12,}/g, '[REDACTED_ANTHROPIC_KEY]');
  out = out.replace(/(?<![A-Za-z0-9_-])sk-(?:proj-|live-|test-)?[0-9A-Za-z_-]{16,}/g, '[REDACTED_OPENAI_KEY]');
  out = out.replace(/(?<![A-Za-z0-9_-])gh[pousr]_[0-9A-Za-z]{16,}/g, '[REDACTED_GITHUB_TOKEN]');
  out = out.replace(/(?<![A-Za-z0-9_-])xox[baprs]-[0-9A-Za-z-]{12,}/g, '[REDACTED_SLACK_TOKEN]');
  out = out.replace(/\bBearer\s+[0-9A-Za-z._~+/-]{12,}=*/gi, 'Bearer [REDACTED_TOKEN]');
  out = out.replace(
    /\b((?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*['"]?)[0-9A-Za-z._~+/-]{12,}(['"]?)/gi,
    '$1[REDACTED_SECRET]$2'
  );

  // 2. Redact any currently configured runtime environment secrets if accidentally embedded
  const runtimeSecrets = [
    process.env.NOOK_API_KEY,
    process.env.NOOK_PASSWORD,
    process.env.NOOK_SECRET_TOKEN,
    process.env.NOOK_APPROVER_PASSWORD,
    process.env.SANDBOX_RUNNER_SECRET,
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
  ];
  for (const sec of runtimeSecrets) {
    const trimmed = (sec || '').trim();
    if (trimmed.length >= 12 && out.includes(trimmed)) {
      out = out.split(trimmed).join('[REDACTED_RUNTIME_SECRET]');
    }
  }

  return out;
}

/**
 * Recursively strips all API keys, authorization tokens, passwords, and private credentials
 * from any object, array, or string payload. Guarantees secrets never enter regular
 * SQLite tables (agent_tasks, missions, evidence_records) or workspace export bundles.
 */
export function scrubSensitiveData<T>(data: T): T {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return redactSecretsInText(data) as unknown as T;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => scrubSensitiveData(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    // Exclude or redact any sensitive key related to API keys, secrets, tokens, or credentials
    if (
      lowerKey.includes('apikey') ||
      lowerKey.includes('api_key') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('password') ||
      lowerKey.includes('credential') ||
      lowerKey.includes('bearer') ||
      (lowerKey.includes('auth') && !lowerKey.includes('author'))
    ) {
      continue;
    }
    result[key] = scrubSensitiveData(value);
  }
  return result as T;
}

export function createAgentTask(task: {
  id?: string;
  missionId: string;
  title: string;
  goal: string;
  assignedAgentId: string;
  dependencies?: string[];
  priority?: 'low' | 'medium' | 'high';
  inputs?: Record<string, unknown>;
}): DbAgentTask {
  const db = getDatabase();
  const id = task.id || `tsk-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  // Strip any API keys, tokens, or credentials from inputs before SQLite insertion
  const cleanInputs = scrubSensitiveData(task.inputs || {});

  db.prepare(`
    INSERT INTO agent_tasks (
      id, mission_id, title, goal, assigned_agent_id, status, dependencies_json,
      priority, inputs_json, outputs_json, observations_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, '{}', '[]', ?, ?)
  `).run(
    id,
    task.missionId,
    task.title,
    task.goal,
    task.assignedAgentId,
    JSON.stringify(task.dependencies || []),
    task.priority || 'medium',
    JSON.stringify(cleanInputs),
    now,
    now
  );

  logAuditEvent('TASK_CREATED', `Task '${task.title}' created for ${task.assignedAgentId}`, 'success', task.assignedAgentId);

  return {
    id,
    missionId: task.missionId,
    title: task.title,
    goal: task.goal,
    assignedAgentId: task.assignedAgentId,
    status: 'pending',
    dependencies: task.dependencies || [],
    priority: task.priority || 'medium',
    inputs: cleanInputs,
    outputs: {},
    observations: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function getAgentTaskById(id: string): DbAgentTask | null {
  const db = getDatabase();
  const r = db.prepare(`SELECT * FROM agent_tasks WHERE id = ?`).get(id) as unknown as AgentTaskRow | undefined;
  if (!r) return null;

  return {
    id: r.id,
    missionId: r.mission_id,
    title: r.title,
    goal: r.goal,
    assignedAgentId: r.assigned_agent_id,
    status: r.status as DbAgentTask['status'],
    dependencies: JSON.parse(r.dependencies_json || '[]'),
    priority: r.priority as DbAgentTask['priority'],
    inputs: JSON.parse(r.inputs_json || '{}'),
    outputs: JSON.parse(r.outputs_json || '{}'),
    observations: JSON.parse(r.observations_json || '[]'),
    verification: r.verification_json ? JSON.parse(r.verification_json) : undefined,
    approvalId: r.approval_id || undefined,
    approvalToken: r.approval_token || undefined,
    error: r.error || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at || undefined,
  };
}

export function listTasksForMission(missionId: string): DbAgentTask[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM agent_tasks WHERE mission_id = ? ORDER BY created_at ASC`).all(missionId) as unknown as AgentTaskRow[];

  return rows.map((r) => ({
    id: r.id,
    missionId: r.mission_id,
    title: r.title,
    goal: r.goal,
    assignedAgentId: r.assigned_agent_id,
    status: r.status as DbAgentTask['status'],
    dependencies: JSON.parse(r.dependencies_json || '[]'),
    priority: r.priority,
    inputs: JSON.parse(r.inputs_json || '{}'),
    outputs: JSON.parse(r.outputs_json || '{}'),
    observations: JSON.parse(r.observations_json || '[]'),
    verification: r.verification_json ? JSON.parse(r.verification_json) : undefined,
    approvalId: r.approval_id || undefined,
    approvalToken: r.approval_token || undefined,
    error: r.error || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at || undefined,
  }));
}

export function updateAgentTask(
  id: string,
  update: {
    status?: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'requires_approval';
    outputs?: Record<string, unknown>;
    error?: string;
    approvalId?: string;
    approvalToken?: string;
  }
): DbAgentTask | null {
  const db = getDatabase();
  const existing = getAgentTaskById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const status = update.status || existing.status;
  const rawOutputs = update.outputs ? { ...existing.outputs, ...update.outputs } : existing.outputs;
  const cleanOutputs = scrubSensitiveData(rawOutputs);
  const completedAt = status === 'completed' || status === 'failed' ? now : existing.completedAt;

  db.prepare(`
    UPDATE agent_tasks
    SET status = ?, outputs_json = ?, error = ?, approval_id = ?, approval_token = ?, updated_at = ?, completed_at = ?
    WHERE id = ?
  `).run(
    status,
    JSON.stringify(cleanOutputs),
    update.error || existing.error || null,
    update.approvalId || existing.approvalId || null,
    update.approvalToken || existing.approvalToken || null,
    now,
    completedAt || null,
    id
  );

  return getAgentTaskById(id);
}

export function addAgentTaskObservation(
  id: string,
  obs: { tool?: string; input?: unknown; output?: string; status: 'success' | 'warning' | 'error' }
): void {
  const db = getDatabase();
  const existing = getAgentTaskById(id);
  if (!existing) return;

  const observations = existing.observations;
  observations.push({
    timestamp: new Date().toISOString(),
    tool: obs.tool,
    input: scrubSensitiveData(obs.input),
    output: typeof obs.output === 'string' ? scrubSensitiveData(obs.output) : obs.output,
    status: obs.status,
  });

  db.prepare(`
    UPDATE agent_tasks
    SET observations_json = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(observations), new Date().toISOString(), id);
}

export function verifyAgentTask(
  id: string,
  verification: {
    verified: boolean;
    method: 'test_exit_code' | 'citation_validation' | 'schema_check' | 'human_approval' | 'structured_test_runner';
    details: string;
  }
): void {
  const db = getDatabase();
  const payload = {
    ...verification,
    verifiedAt: new Date().toISOString(),
  };

  db.prepare(`
    UPDATE agent_tasks
    SET verification_json = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(payload), new Date().toISOString(), id);

  logAuditEvent('TASK_VERIFIED', `Task ${id} verification: ${verification.verified ? 'PASSED' : 'FAILED'} (${verification.method})`, verification.verified ? 'success' : 'failed');
}

// ==========================================
// EVIDENCE ENGINE (Stage 4)
// ==========================================
export interface DbEvidenceRecord {
  id: string;
  missionId?: string;
  taskId?: string;
  agentId: string;
  agentName: string;
  timestamp: string;
  actionType: 'model_call' | 'tool_selection' | 'tool_exec' | 'human_approval' | 'browser_visit' | 'file_write' | 'shell_exec' | 'verification';
  summary: string;
  details: {
    toolName?: string;
    inputParams?: Record<string, unknown>;
    output?: string;
    exitCode?: number;
    sourceCitations?: string[];
    fileDiff?: string;
    filePath?: string;
    verificationResult?: boolean;
  };
  status: 'success' | 'warning' | 'failed' | 'blocked';
}

export function recordEvidence(record: {
  missionId?: string;
  taskId?: string;
  agentId: string;
  agentName: string;
  actionType: 'model_call' | 'tool_selection' | 'tool_exec' | 'human_approval' | 'browser_visit' | 'file_write' | 'shell_exec' | 'verification';
  summary: string;
  details?: Record<string, unknown>;
  status?: 'success' | 'warning' | 'failed' | 'blocked';
}): DbEvidenceRecord {
  const db = getDatabase();
  const id = `ev-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  // Deeply sanitize details: scrub all API keys, tokens, and credentials
  const safeDetails = scrubSensitiveData(record.details || {});

  db.prepare(`
    INSERT INTO evidence_records (
      id, mission_id, task_id, agent_id, agent_name, timestamp, action_type, summary, details_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.missionId || null,
    record.taskId || null,
    record.agentId,
    record.agentName,
    now,
    record.actionType,
    record.summary,
    JSON.stringify(safeDetails),
    record.status || 'success'
  );

  return {
    id,
    missionId: record.missionId,
    taskId: record.taskId,
    agentId: record.agentId,
    agentName: record.agentName,
    timestamp: now,
    actionType: record.actionType,
    summary: record.summary,
    details: safeDetails,
    status: record.status || 'success',
  };
}

export function listEvidence(filter?: { missionId?: string; taskId?: string; agentId?: string }): DbEvidenceRecord[] {
  const db = getDatabase();
  let query = `SELECT * FROM evidence_records WHERE 1=1`;
  const params: (string | number)[] = [];

  if (filter?.missionId) {
    query += ` AND mission_id = ?`;
    params.push(filter.missionId);
  }
  if (filter?.taskId) {
    query += ` AND task_id = ?`;
    params.push(filter.taskId);
  }
  if (filter?.agentId) {
    query += ` AND agent_id = ?`;
    params.push(filter.agentId);
  }

  query += ` ORDER BY timestamp ASC`;
  const rows = db.prepare(query).all(...params) as unknown as EvidenceRow[];

  return rows.map((r) => ({
    id: r.id,
    missionId: r.mission_id || undefined,
    taskId: r.task_id || undefined,
    agentId: r.agent_id,
    agentName: r.agent_name,
    timestamp: r.timestamp,
    actionType: r.action_type,
    summary: r.summary,
    details: JSON.parse(r.details_json || '{}'),
    status: r.status as DbEvidenceRecord['status'],
  }));
}

export function exportRedactedActivityReport(missionId?: string): {
  reportDate: string;
  totalRecords: number;
  missionId?: string;
  timeline: {
    time: string;
    agent: string;
    type: string;
    summary: string;
    status: string;
    citations?: string[];
    exitCode?: number;
  }[];
} {
  const records = listEvidence({ missionId });

  return {
    reportDate: new Date().toISOString(),
    totalRecords: records.length,
    missionId,
    timeline: records.map((r) => ({
      time: r.timestamp,
      agent: r.agentName,
      type: r.actionType,
      summary: r.summary,
      status: r.status,
      citations: r.details.sourceCitations,
      exitCode: r.details.exitCode,
    })),
  };
}

// ==========================================
// ATOMIC DATABASE-BACKED WORKER LEASES
// ==========================================
export interface WorkerLease {
  resourceId: string;
  ownerId: string;
  fencingToken: number;
  acquiredAt: string;
  expiresAt: string;
}

/**
 * Atomically acquires or renews a lease on a shared resource (e.g., a Mission or Background Job).
 * Prevents split-brain and concurrent execution across web servers and dedicated workers
 * using atomic SQLite upserts, expiration timestamps, and incrementing fencing tokens.
 */
export function acquireWorkerLease(
  resourceId: string,
  ownerId: string,
  durationMs: number = 25000
): { acquired: boolean; fencingToken: number; ownerId: string } {
  const db = getDatabase();
  const now = Date.now();
  const acquiredAt = new Date(now).toISOString();
  const expiresAt = new Date(now + durationMs).toISOString();

  // Atomic SQLite upsert guarded by lease expiration and ownership check
  const stmt = db.prepare(`
    INSERT INTO worker_leases (resource_id, owner_id, fencing_token, acquired_at, expires_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(resource_id) DO UPDATE SET
      owner_id = excluded.owner_id,
      fencing_token = worker_leases.fencing_token + 1,
      acquired_at = excluded.acquired_at,
      expires_at = excluded.expires_at
    WHERE worker_leases.expires_at < ? OR worker_leases.owner_id = ?
  `);

  const info = stmt.run(resourceId, ownerId, acquiredAt, expiresAt, acquiredAt, ownerId);
  if (info.changes === 0) {
    const current = db.prepare(`SELECT * FROM worker_leases WHERE resource_id = ?`).get(resourceId) as unknown as WorkerLeaseRow | undefined;
    return {
      acquired: false,
      fencingToken: current ? current.fencing_token : 0,
      ownerId: current ? current.owner_id : '',
    };
  }

  const updated = db.prepare(`SELECT * FROM worker_leases WHERE resource_id = ?`).get(resourceId) as unknown as WorkerLeaseRow;
  return {
    acquired: true,
    fencingToken: updated.fencing_token,
    ownerId: updated.owner_id,
  };
}

/**
 * Releases a worker lease cleanly once task processing is complete or aborted.
 * Preserves the resource row so fencing tokens strictly monotonically increment across acquisitions.
 */
export function releaseWorkerLease(resourceId: string, ownerId: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE worker_leases
    SET owner_id = '', expires_at = '1970-01-01T00:00:00.000Z'
    WHERE resource_id = ? AND owner_id = ?
  `);
  const info = stmt.run(resourceId, ownerId);
  return info.changes > 0;
}

/**
 * Validates whether a specific worker holds a valid, active unexpired lease with the expected fencing token.
 */
export function validateWorkerLease(resourceId: string, ownerId: string, expectedFencingToken?: number): boolean {
  const db = getDatabase();
  const nowIso = new Date().toISOString();
  let query = `SELECT * FROM worker_leases WHERE resource_id = ? AND owner_id = ? AND expires_at > ?`;
  const params: (string | number)[] = [resourceId, ownerId, nowIso];
  if (expectedFencingToken !== undefined) {
    query += ` AND fencing_token = ?`;
    params.push(expectedFencingToken);
  }
  const row = db.prepare(query).get(...params);
  return Boolean(row);
}

/**
 * Renews an active worker lease via heartbeat.
 * Strictly checks that:
 * 1. ownerId matches the current lease owner.
 * 2. fencingToken matches the current lease token.
 * 3. The current lease has not already expired.
 */
export function renewWorkerLeaseHeartbeat(
  resourceId: string,
  ownerId: string,
  fencingToken: number,
  durationMs: number = 25000
): { renewed: boolean; expiresAt?: string; error?: string } {
  const db = getDatabase();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const newExpiresAt = new Date(now + durationMs).toISOString();

  const stmt = db.prepare(`
    UPDATE worker_leases
    SET expires_at = ?
    WHERE resource_id = ? AND owner_id = ? AND fencing_token = ? AND expires_at > ?
  `);
  const info = stmt.run(newExpiresAt, resourceId, ownerId, fencingToken, nowIso);
  if (info.changes === 0) {
    const current = db.prepare(`SELECT * FROM worker_leases WHERE resource_id = ?`).get(resourceId) as unknown as WorkerLeaseRow | undefined;
    return {
      renewed: false,
      error: !current
        ? 'Lease not found'
        : current.owner_id !== ownerId
        ? `Lease acquired by another worker (${current.owner_id})`
        : current.fencing_token !== fencingToken
        ? `Fencing token mismatch (current: ${current.fencing_token}, provided: ${fencingToken})`
        : 'Lease expired before heartbeat',
    };
  }

  return { renewed: true, expiresAt: newExpiresAt };
}

/**
 * Atomically commits a mission status change and verifies the fencing token.
 * Prevents split-brain state writes if the worker lost the lease during task execution.
 */
export function commitMissionStateWithFencing(
  missionId: string,
  ownerId: string,
  fencingToken: number,
  newStatus: 'active' | 'completed' | 'failed' | 'paused' | 'cancelled'
): { committed: boolean; error?: string } {
  const db = getDatabase();
  const leaseResource = `mission:${missionId}`;
  const nowIso = new Date().toISOString();

  // Validate lease inside transaction
  db.exec('BEGIN TRANSACTION;');
  try {
    const validLease = db.prepare(`
      SELECT * FROM worker_leases
      WHERE resource_id = ? AND owner_id = ? AND fencing_token = ? AND expires_at > ?
    `).get(leaseResource, ownerId, fencingToken, nowIso);

    if (!validLease) {
      db.exec('ROLLBACK;');
      return {
        committed: false,
        error: `Fencing violation: Worker ${ownerId} token ${fencingToken} does not hold an active lease for ${leaseResource}`,
      };
    }

    db.prepare(`
      UPDATE missions
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, nowIso, missionId);

    db.exec('COMMIT;');
    return { committed: true };
  } catch (err: unknown) {
    db.exec('ROLLBACK;');
    return { committed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const WORKER_HEARTBEAT_RESOURCE = '__system_worker_heartbeat__';

/**
 * Records a worker heartbeat in the durable SQLite `worker_leases` table so `/api/health`
 * can independently verify whether an active background worker loop has ticked recently.
 */
export function recordWorkerHeartbeat(workerId: string = `worker-${process.pid}`, ttlMs: number = 30000): void {
  try {
    const db = getDatabase();
    const now = Date.now();
    const acquiredAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    db.prepare(`
      INSERT INTO worker_leases (resource_id, owner_id, fencing_token, acquired_at, expires_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(resource_id) DO UPDATE SET
        owner_id = excluded.owner_id,
        fencing_token = worker_leases.fencing_token + 1,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    `).run(WORKER_HEARTBEAT_RESOURCE, workerId, acquiredAt, expiresAt);
  } catch {
    // ignore transient DB lock during heartbeat
  }
}

export function getWorkerHeartbeatStatus(maxAgeMs: number = 45000): {
  active: boolean;
  status: 'ok' | 'stale' | 'not_started';
  workerId?: string;
  lastHeartbeatAt?: string;
  expiresAt?: string;
  ageMs?: number;
} {
  try {
    const db = getDatabase();
    const row = db
      .prepare(`SELECT * FROM worker_leases WHERE resource_id = ?`)
      .get(WORKER_HEARTBEAT_RESOURCE) as unknown as WorkerLeaseRow | undefined;
    if (!row || !row.owner_id) {
      return { active: false, status: 'not_started' };
    }
    const acquiredMs = Date.parse(row.acquired_at);
    const ageMs = isNaN(acquiredMs) ? Infinity : Math.max(0, Date.now() - acquiredMs);
    const active = ageMs <= maxAgeMs;
    return {
      active,
      status: active ? 'ok' : 'stale',
      workerId: row.owner_id,
      lastHeartbeatAt: row.acquired_at,
      expiresAt: row.expires_at,
      ageMs: isFinite(ageMs) ? ageMs : undefined,
    };
  } catch {
    return { active: false, status: 'not_started' };
  }
}

// ==========================================
// SOVEREIGN WORKSPACE EXPORT & IMPORT (v2)
// ==========================================

export interface SnapshotManifest {
  schemaVersion: number;
  nookVersion: string;
  exportedAt: string;
  totalSpaces: number;
  totalDocs: number;
  totalRevisions: number;
  totalMissions: number;
  totalTasks: number;
  totalEvidence: number;
  totalApprovals: number;
  /** Integrity checksum (SHA-256 over canonical bundle) for detecting accidental corruption. */
  checksum: string;
  integrityChecksum: string;
  /** Optional HMAC-SHA256 provenance signature when signed with server secret. */
  signature?: string;
}

export interface SnapshotValidationResult {
  valid: boolean;
  schemaVersion: number;
  manifest?: SnapshotManifest;
  signatureStatus: 'verified' | 'unsigned' | 'invalid';
  errors: string[];
  warnings: string[];
  summary: {
    spacesCount: number;
    docsCount: number;
    revisionsCount: number;
    missionsCount: number;
    tasksCount: number;
    evidenceCount: number;
    approvalsCount: number;
  };
}

export interface DatabaseIntegrityResult {
  healthy: boolean;
  integrityCheck: string;
  foreignKeyViolations: any[];
}

function canonicalize(obj: any, depth: number = 0): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => (item === undefined ? null : canonicalize(item, depth + 1)));
  }
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, any> = {};
  for (const key of sortedKeys) {
    if (obj[key] === undefined) {
      continue;
    }
    if (depth === 0 && (key === 'manifest' || key === 'checksum')) {
      continue;
    }
    result[key] = canonicalize(obj[key], depth + 1);
  }
  return result;
}

export function computeSnapshotChecksum(bundle: Record<string, any>): string {
  if (!bundle || typeof bundle !== 'object') return '';
  const canonical = JSON.stringify(canonicalize(bundle, 0));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function getSnapshotSigningSecret(): string | null {
  const sec = (
    process.env.NOOK_SNAPSHOT_SIGNING_SECRET ||
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();
  return sec.length >= 8 ? sec : null;
}

export function computeSnapshotSignature(checksum: string, secret?: string | null): string | undefined {
  const signingKey = secret ?? getSnapshotSigningSecret();
  if (!signingKey || !checksum) return undefined;
  const hmac = crypto.createHmac('sha256', signingKey).update(`nook-snapshot-v2:${checksum}`).digest('hex');
  return `hmac-sha256:${hmac}`;
}

function verifySnapshotSignatureConstantTime(actualSig: string, expectedSig?: string): boolean {
  if (!actualSig || !expectedSig) return false;
  const aBuf = Buffer.from(actualSig, 'utf8');
  const bBuf = Buffer.from(expectedSig, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyDatabaseIntegrity(db: DatabaseSync = getDatabase()): DatabaseIntegrityResult {
  const checkRow = db.prepare('PRAGMA integrity_check;').get() as { integrity_check?: string } | undefined;
  const integrityCheck = checkRow?.integrity_check || 'ok';
  const fkRows = db.prepare('PRAGMA foreign_key_check;').all();

  return {
    healthy: integrityCheck.toLowerCase() === 'ok' && fkRows.length === 0,
    integrityCheck,
    foreignKeyViolations: fkRows,
  };
}

export const SAFE_SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const SAFE_SNAPSHOT_FILENAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
export const MAX_SNAPSHOT_DOCUMENTS = 2000;
export const MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT = 100;
export const MAX_SNAPSHOT_SANDBOX_FILE_BYTES = 512 * 1024; // 512KB per file

export function validateWorkspaceSnapshot(
  bundle: any,
  options?: { requireSignature?: boolean; signingSecret?: string }
): SnapshotValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!bundle || typeof bundle !== 'object') {
    return {
      valid: false,
      schemaVersion: 0,
      signatureStatus: 'unsigned',
      errors: ['Invalid bundle: snapshot payload must be a non-null object'],
      warnings: [],
      summary: { spacesCount: 0, docsCount: 0, revisionsCount: 0, missionsCount: 0, tasksCount: 0, evidenceCount: 0, approvalsCount: 0 },
    };
  }

  const schemaVersion = Number(bundle.schemaVersion);
  if (!schemaVersion || (schemaVersion !== 1 && schemaVersion !== 2)) {
    errors.push(`Unsupported or missing schemaVersion: expected 1 or 2, got ${bundle.schemaVersion}`);
  }

  // Strict manifest & SHA-256 integrity checksum verification
  const computed = `sha256:${computeSnapshotChecksum(bundle)}`;
  if (bundle.manifest !== undefined) {
    if (!bundle.manifest || typeof bundle.manifest !== 'object' || Array.isArray(bundle.manifest)) {
      errors.push('Field "manifest" must be a non-null object when present');
    } else {
      const rawChecksum = typeof bundle.manifest.checksum === 'string' ? bundle.manifest.checksum : '';
      const rawIntegrityChecksum =
        typeof bundle.manifest.integrityChecksum === 'string' ? bundle.manifest.integrityChecksum : '';
      const expectedChecksum = rawChecksum || rawIntegrityChecksum;

      if (!expectedChecksum || !expectedChecksum.startsWith('sha256:')) {
        errors.push('Snapshot manifest is missing required sha256 integrity checksum');
      } else {
        if (rawChecksum && rawIntegrityChecksum && rawChecksum !== rawIntegrityChecksum) {
          errors.push(
            `Snapshot integrity checksum mismatch: manifest.checksum (${rawChecksum}) and manifest.integrityChecksum (${rawIntegrityChecksum}) do not match`
          );
        }
        if (rawChecksum && rawChecksum !== computed) {
          errors.push(
            `Snapshot integrity checksum mismatch: expected ${rawChecksum}, got ${computed} (bundle may be corrupted or modified)`
          );
        } else if (rawIntegrityChecksum && rawIntegrityChecksum !== computed) {
          errors.push(
            `Snapshot integrity checksum mismatch: expected ${rawIntegrityChecksum}, got ${computed} (bundle may be corrupted or modified)`
          );
        }
      }
    }
  }

  // Provenance HMAC signature verification
  const requireSignature =
    options?.requireSignature ?? process.env.NOOK_REQUIRE_SNAPSHOT_SIGNATURE === 'true';
  let signatureStatus: 'verified' | 'unsigned' | 'invalid' = 'unsigned';
  if (bundle.manifest?.signature) {
    const expectedSig = computeSnapshotSignature(computed, options?.signingSecret);
    if (verifySnapshotSignatureConstantTime(String(bundle.manifest.signature), expectedSig)) {
      signatureStatus = 'verified';
    } else {
      signatureStatus = 'invalid';
      errors.push('Snapshot provenance signature verification failed: HMAC signature does not match server signing key');
    }
  } else if (requireSignature) {
    signatureStatus = 'invalid';
    errors.push('Snapshot provenance signature is required by policy, but bundle is unsigned');
  }

  // Validate workspace.computerStates agent IDs and sandbox files (NOOK-P1-01)
  if (bundle.workspace !== undefined) {
    if (!bundle.workspace || typeof bundle.workspace !== 'object' || Array.isArray(bundle.workspace)) {
      errors.push('Field "workspace" must be an object');
    } else if (bundle.workspace.computerStates !== undefined) {
      const cs = bundle.workspace.computerStates;
      if (!cs || typeof cs !== 'object' || Array.isArray(cs)) {
        errors.push('Field "workspace.computerStates" must be an object map of agentId -> state');
      } else {
        for (const [agentId, rawState] of Object.entries(cs)) {
          if (
            !SAFE_SNAPSHOT_ID_PATTERN.test(agentId) ||
            agentId === '.' ||
            agentId === '..' ||
            agentId.includes('/') ||
            agentId.includes('\\')
          ) {
            errors.push(`Invalid or unsafe agentId in workspace.computerStates: "${agentId}" (must match ^[A-Za-z0-9_-]{1,64}$)`);
            continue;
          }
          const stateObj = rawState as { files?: unknown };
          if (stateObj && stateObj.files !== undefined) {
            if (!Array.isArray(stateObj.files)) {
              errors.push(`workspace.computerStates["${agentId}"].files must be an array`);
            } else if (stateObj.files.length > MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT) {
              errors.push(`workspace.computerStates["${agentId}"].files exceeds limit of ${MAX_SNAPSHOT_SANDBOX_FILES_PER_AGENT} files`);
            } else {
              for (let k = 0; k < stateObj.files.length; k++) {
                const file = stateObj.files[k] as { name?: unknown; content?: unknown };
                if (!file || typeof file !== 'object') {
                  errors.push(`Invalid file entry at workspace.computerStates["${agentId}"].files[${k}]`);
                  continue;
                }
                const fileName = typeof file.name === 'string' ? file.name : '';
                if (
                  !SAFE_SNAPSHOT_FILENAME_PATTERN.test(fileName) ||
                  fileName === '.' ||
                  fileName === '..' ||
                  fileName.includes('/') ||
                  fileName.includes('\\')
                ) {
                  errors.push(`Unsafe or invalid filename "${fileName}" in workspace.computerStates["${agentId}"]`);
                }
                if (typeof file.content === 'string' && Buffer.byteLength(file.content, 'utf8') > MAX_SNAPSHOT_SANDBOX_FILE_BYTES) {
                  errors.push(`File "${fileName}" in workspace.computerStates["${agentId}"] exceeds maximum size of ${MAX_SNAPSHOT_SANDBOX_FILE_BYTES} bytes`);
                }
              }
            }
          }
        }
      }
    }
  }

  // Spaces & pages
  let spacesCount = 0;
  let docsCount = 0;
  if (bundle.spaces !== undefined) {
    if (!Array.isArray(bundle.spaces)) {
      errors.push('Field "spaces" must be an array');
    } else {
      spacesCount = bundle.spaces.length;
      for (let i = 0; i < bundle.spaces.length; i++) {
        const s = bundle.spaces[i];
        if (!s || typeof s !== 'object' || !s.id || !s.name) {
          errors.push(`Invalid space at index ${i}: missing "id" or "name"`);
        }
        if (s.pages) {
          if (!Array.isArray(s.pages)) {
            errors.push(`Space "${s?.id || i}" has invalid pages: expected array`);
          } else {
            docsCount += s.pages.length;
            if (docsCount > MAX_SNAPSHOT_DOCUMENTS) {
              errors.push(`Total documents in snapshot exceeds maximum limit of ${MAX_SNAPSHOT_DOCUMENTS}`);
              break;
            }
            for (let j = 0; j < s.pages.length; j++) {
              const p = s.pages[j];
              if (!p || typeof p !== 'object' || !p.id || !p.title) {
                errors.push(`Invalid document at space "${s?.id || i}" index ${j}: missing "id" or "title"`);
              }
            }
          }
        }
      }
    }
  }

  // Document revisions
  let revisionsCount = 0;
  if (bundle.documentRevisions !== undefined) {
    if (!Array.isArray(bundle.documentRevisions)) {
      errors.push('Field "documentRevisions" must be an array');
    } else {
      revisionsCount = bundle.documentRevisions.length;
      for (let i = 0; i < bundle.documentRevisions.length; i++) {
        const r = bundle.documentRevisions[i];
        if (!r || typeof r !== 'object' || !r.id || !r.documentId) {
          errors.push(`Invalid revision at index ${i}: missing "id" or "documentId"`);
        }
      }
    }
  }

  // Missions & tasks
  let missionsCount = 0;
  let tasksCount = 0;
  const taskDependencyGraph = new Map<string, string[]>();

  if (bundle.missions !== undefined) {
    if (!Array.isArray(bundle.missions)) {
      errors.push('Field "missions" must be an array');
    } else {
      missionsCount = bundle.missions.length;
      for (let i = 0; i < bundle.missions.length; i++) {
        const m = bundle.missions[i];
        if (!m || typeof m !== 'object' || !m.id || !m.title) {
          errors.push(`Invalid mission at index ${i}: missing "id" or "title"`);
        }
        if (m.tasks) {
          if (!Array.isArray(m.tasks)) {
            errors.push(`Mission "${m?.id || i}" tasks must be an array`);
          } else {
            tasksCount += m.tasks.length;
            for (let j = 0; j < m.tasks.length; j++) {
              const t = m.tasks[j];
              if (!t || typeof t !== 'object' || !t.id || !t.title) {
                errors.push(`Invalid task at mission "${m?.id || i}" index ${j}: missing "id" or "title"`);
              } else {
                const deps = Array.isArray(t.dependencies) ? t.dependencies : [];
                taskDependencyGraph.set(t.id, deps);
              }
              if (t.approvalToken) {
                warnings.push(`Task "${t.id}" contains an embedded approvalToken; it will be sanitized upon import`);
              }
            }
          }
        }
      }
    }
  }

  // Check top-level tasks if present
  if (bundle.tasks !== undefined && Array.isArray(bundle.tasks)) {
    tasksCount += bundle.tasks.length;
    for (const t of bundle.tasks) {
      if (t?.id) {
        const deps = Array.isArray(t.dependencies) ? t.dependencies : [];
        taskDependencyGraph.set(t.id, deps);
      }
    }
  }

  // Detect cyclic dependencies in tasks
  const visited = new Set<string>();
  const recStack = new Set<string>();
  function hasCycle(taskId: string): boolean {
    visited.add(taskId);
    recStack.add(taskId);
    const deps = taskDependencyGraph.get(taskId) || [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        if (hasCycle(dep)) return true;
      } else if (recStack.has(dep)) {
        return true;
      }
    }
    recStack.delete(taskId);
    return false;
  }
  for (const taskId of taskDependencyGraph.keys()) {
    if (!visited.has(taskId)) {
      if (hasCycle(taskId)) {
        errors.push(`Cyclic dependency detected in task graph involving task "${taskId}"`);
        break;
      }
    }
  }

  // Evidence
  let evidenceCount = 0;
  if (bundle.evidenceTimeline !== undefined) {
    if (!Array.isArray(bundle.evidenceTimeline)) {
      errors.push('Field "evidenceTimeline" must be an array');
    } else {
      evidenceCount = bundle.evidenceTimeline.length;
    }
  }

  // Approvals
  let approvalsCount = 0;
  if (bundle.approvalsAudit !== undefined) {
    if (!Array.isArray(bundle.approvalsAudit)) {
      errors.push('Field "approvalsAudit" must be an array');
    } else {
      approvalsCount = bundle.approvalsAudit.length;
      for (const appr of bundle.approvalsAudit) {
        if (appr.singleUseToken || appr.single_use_token) {
          warnings.push(`Approval record "${appr.id}" contains singleUseToken; it will be cleared upon import`);
        }
      }
    }
  }

  // Verify manifest entity counts and schemaVersion against actual payload when manifest is present
  if (bundle.manifest && typeof bundle.manifest === 'object' && !Array.isArray(bundle.manifest)) {
    const mf = bundle.manifest as Partial<SnapshotManifest>;
    if (mf.schemaVersion !== undefined && Number(mf.schemaVersion) !== schemaVersion) {
      errors.push(`Snapshot manifest schemaVersion (${mf.schemaVersion}) does not match bundle schemaVersion (${schemaVersion})`);
    }
    if (typeof mf.totalSpaces === 'number' && mf.totalSpaces !== spacesCount) {
      errors.push(`Snapshot manifest count mismatch: expected totalSpaces=${mf.totalSpaces}, found ${spacesCount}`);
    }
    if (typeof mf.totalDocs === 'number' && mf.totalDocs !== docsCount) {
      errors.push(`Snapshot manifest count mismatch: expected totalDocs=${mf.totalDocs}, found ${docsCount}`);
    }
    if (typeof mf.totalRevisions === 'number' && mf.totalRevisions !== revisionsCount) {
      errors.push(`Snapshot manifest count mismatch: expected totalRevisions=${mf.totalRevisions}, found ${revisionsCount}`);
    }
    if (typeof mf.totalMissions === 'number' && mf.totalMissions !== missionsCount) {
      errors.push(`Snapshot manifest count mismatch: expected totalMissions=${mf.totalMissions}, found ${missionsCount}`);
    }
    if (typeof mf.totalTasks === 'number' && mf.totalTasks !== tasksCount) {
      errors.push(`Snapshot manifest count mismatch: expected totalTasks=${mf.totalTasks}, found ${tasksCount}`);
    }
    if (typeof mf.totalEvidence === 'number' && mf.totalEvidence !== evidenceCount) {
      errors.push(`Snapshot manifest count mismatch: expected totalEvidence=${mf.totalEvidence}, found ${evidenceCount}`);
    }
    if (typeof mf.totalApprovals === 'number' && mf.totalApprovals !== approvalsCount) {
      errors.push(`Snapshot manifest count mismatch: expected totalApprovals=${mf.totalApprovals}, found ${approvalsCount}`);
    }
  }

  return {
    valid: errors.length === 0,
    schemaVersion: schemaVersion || 2,
    manifest: bundle.manifest,
    signatureStatus,
    errors,
    warnings,
    summary: {
      spacesCount,
      docsCount,
      revisionsCount,
      missionsCount,
      tasksCount,
      evidenceCount,
      approvalsCount,
    },
  };
}

export function exportWorkspaceSnapshot(db: DatabaseSync = getDatabase()): {
  nookVersion: string;
  exportedAt: string;
  schemaVersion: number;
  manifest: SnapshotManifest;
  spaces: Array<{
    id: string;
    name: string;
    icon: string;
    createdAt: string;
    updatedAt: string;
    pages: Array<{
      id: string;
      spaceId: string;
      title: string;
      content: string;
      excerpt?: string;
      icon?: string;
      authorAgentId: string;
      version: number;
      tags: string[];
      createdAt: string;
      updatedAt: string;
    }>;
  }>;
  documentRevisions: DbDocumentRevision[];
  missions: DbMission[];
  evidenceTimeline: DbEvidenceRecord[];
  approvalsAudit: DbApprovalRecord[];
} {
  const spaceRows = db.prepare(`SELECT * FROM spaces ORDER BY created_at ASC`).all() as unknown as SpaceRow[];
  const docRows = db.prepare(`SELECT * FROM documents ORDER BY updated_at DESC`).all() as unknown as DocumentRow[];
  const spaces = spaceRows.map((s) => ({
    id: s.id,
    name: s.name,
    icon: s.icon || 'folder',
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    pages: docRows
      .filter((d) => d.space_id === s.id)
      .map((d) => ({
        id: d.id,
        spaceId: d.space_id,
        title: d.title,
        content: d.content,
        excerpt: d.excerpt || undefined,
        icon: d.icon || undefined,
        authorAgentId: d.author_agent_id,
        version: d.version,
        tags: JSON.parse(d.tags_json || '[]'),
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      })),
  }));
  
  const revRows = db.prepare(`SELECT * FROM document_revisions ORDER BY version ASC`).all() as unknown as RevisionRow[];
  const documentRevisions: DbDocumentRevision[] = revRows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    version: r.version,
    title: r.title,
    content: r.content,
    authorAgentId: r.author_agent_id,
    createdAt: r.created_at,
    changeSummary: r.change_summary || undefined,
  }));

  const missionRows = db.prepare(`SELECT * FROM missions ORDER BY created_at ASC`).all() as unknown as MissionRow[];
  const missions: DbMission[] = missionRows.map((row) => {
    const rawTasks = db.prepare(`SELECT * FROM agent_tasks WHERE mission_id = ? ORDER BY created_at ASC`).all(row.id) as unknown as AgentTaskRow[];
    const tasks: DbAgentTask[] = rawTasks.map((r) => ({
      id: r.id,
      missionId: r.mission_id,
      title: scrubSensitiveData(r.title),
      goal: scrubSensitiveData(r.goal),
      assignedAgentId: r.assigned_agent_id,
      status: r.status as DbAgentTask['status'],
      dependencies: JSON.parse(r.dependencies_json || '[]'),
      priority: r.priority as DbAgentTask['priority'],
      inputs: scrubSensitiveData(JSON.parse(r.inputs_json || '{}')),
      outputs: scrubSensitiveData(JSON.parse(r.outputs_json || '{}')),
      observations: scrubSensitiveData(JSON.parse(r.observations_json || '[]')),
      verification: r.verification_json ? scrubSensitiveData(JSON.parse(r.verification_json)) : undefined,
      approvalId: r.approval_id || undefined,
      approvalToken: undefined, // NEVER export single-use tokens!
      error: r.error ? scrubSensitiveData(r.error) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || undefined,
    }));

    return {
      id: row.id,
      title: scrubSensitiveData(row.title),
      objective: scrubSensitiveData(row.objective),
      status: row.status as DbMission['status'],
      priority: row.priority as DbMission['priority'],
      assignedAgents: JSON.parse(row.assigned_agents_json || '[]'),
      milestones: JSON.parse(row.milestones_json || '[]'),
      budget: row.budget_json ? scrubSensitiveData(JSON.parse(row.budget_json)) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
      tasks,
    };
  });

  const evRows = db.prepare(`SELECT * FROM evidence_records ORDER BY timestamp ASC`).all() as unknown as EvidenceRow[];
  const evidenceTimeline: DbEvidenceRecord[] = evRows.map((r) => ({
    id: r.id,
    missionId: r.mission_id || undefined,
    taskId: r.task_id || undefined,
    agentId: r.agent_id,
    agentName: r.agent_name,
    timestamp: r.timestamp,
    actionType: r.action_type,
    summary: scrubSensitiveData(r.summary),
    details: scrubSensitiveData(JSON.parse(r.details_json || '{}')),
    status: r.status as DbEvidenceRecord['status'],
  }));

  const approvalsAudit = listApprovals(false, db);

  const totalTasks = missions.reduce((acc, m) => acc + (m.tasks?.length || 0), 0);
  const totalDocs = spaces.reduce((acc, s) => acc + (s.pages?.length || 0), 0);
  const exportedAt = new Date().toISOString();

  const coreBundle = scrubSensitiveData({
    nookVersion: '1.0.0',
    exportedAt,
    schemaVersion: 2,
    spaces,
    documentRevisions,
    missions,
    evidenceTimeline,
    approvalsAudit,
  });

  const checksum = `sha256:${computeSnapshotChecksum(coreBundle)}`;
  const signature = computeSnapshotSignature(checksum);
  const manifest: SnapshotManifest = {
    schemaVersion: 2,
    nookVersion: '1.0.0',
    exportedAt,
    totalSpaces: spaces.length,
    totalDocs,
    totalRevisions: documentRevisions.length,
    totalMissions: missions.length,
    totalTasks,
    totalEvidence: evidenceTimeline.length,
    totalApprovals: approvalsAudit.length,
    checksum,
    integrityChecksum: checksum,
    ...(signature ? { signature } : {}),
  };

  return {
    ...coreBundle,
    manifest,
  };
}

export interface ImportSnapshotOptions {
  conflictStrategy?: 'merge' | 'replace' | 'abort';
  requireSignature?: boolean;
  signingSecret?: string;
}

export function importWorkspaceSnapshot(
  bundle: any,
  db: DatabaseSync = getDatabase(),
  options?: ImportSnapshotOptions
): {
  success: boolean;
  validation: SnapshotValidationResult;
  importedSpacesCount: number;
  importedDocsCount: number;
  importedRevisionsCount: number;
  importedMissionsCount: number;
  importedTasksCount: number;
  importedEvidenceCount: number;
  importedApprovalsCount: number;
} {
  const validation = validateWorkspaceSnapshot(bundle, {
    requireSignature: options?.requireSignature,
    signingSecret: options?.signingSecret,
  });
  if (!validation.valid) {
    throw new Error(`Invalid workspace bundle: ${validation.errors.join('; ')}`);
  }

  const conflictStrategy = options?.conflictStrategy || bundle?.conflictStrategy || 'merge';
  if (!['merge', 'replace', 'abort'].includes(conflictStrategy)) {
    throw new Error(`Invalid conflictStrategy: expected 'merge', 'replace', or 'abort', got '${conflictStrategy}'`);
  }

  let importedSpacesCount = 0;
  let importedDocsCount = 0;
  let importedRevisionsCount = 0;
  let importedMissionsCount = 0;
  let importedTasksCount = 0;
  let importedEvidenceCount = 0;
  let importedApprovalsCount = 0;

  db.exec('SAVEPOINT nook_snapshot_import;');
  try {
    if (conflictStrategy === 'abort') {
      // Check for any pre-existing colliding IDs before writing a single row
      if (Array.isArray(bundle.spaces)) {
        const checkSpace = db.prepare('SELECT id FROM spaces WHERE id = ?');
        const checkDoc = db.prepare('SELECT id FROM documents WHERE id = ?');
        for (const s of bundle.spaces) {
          if (s?.id && checkSpace.get(s.id)) {
            throw new Error(`ConflictError: Space "${s.id}" already exists (conflictStrategy=abort)`);
          }
          if (Array.isArray(s?.pages)) {
            for (const p of s.pages) {
              if (p?.id && checkDoc.get(p.id)) {
                throw new Error(`ConflictError: Document "${p.id}" already exists (conflictStrategy=abort)`);
              }
            }
          }
        }
      }
      if (Array.isArray(bundle.missions)) {
        const checkMission = db.prepare('SELECT id FROM missions WHERE id = ?');
        const checkTask = db.prepare('SELECT id FROM agent_tasks WHERE id = ?');
        for (const m of bundle.missions) {
          if (m?.id && checkMission.get(m.id)) {
            throw new Error(`ConflictError: Mission "${m.id}" already exists (conflictStrategy=abort)`);
          }
          if (Array.isArray(m?.tasks)) {
            for (const t of m.tasks) {
              if (t?.id && checkTask.get(t.id)) {
                throw new Error(`ConflictError: Task "${t.id}" already exists (conflictStrategy=abort)`);
              }
            }
          }
        }
      }
    } else if (conflictStrategy === 'replace') {
      db.exec(`
        DELETE FROM document_revisions;
        DELETE FROM documents;
        DELETE FROM spaces;
        DELETE FROM evidence_records;
        DELETE FROM agent_tasks;
        DELETE FROM missions;
        DELETE FROM approvals;
      `);
    }
    // 1. Spaces & Documents
    if (Array.isArray(bundle.spaces)) {
      const insertSpace = db.prepare(`
        INSERT INTO spaces (id, name, icon, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          icon = excluded.icon,
          updated_at = excluded.updated_at
      `);
      const insertDoc = db.prepare(`
        INSERT INTO documents (
          id, space_id, title, content, excerpt, icon, author_agent_id, version, tags_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          space_id = excluded.space_id,
          title = excluded.title,
          content = excluded.content,
          excerpt = excluded.excerpt,
          icon = excluded.icon,
          author_agent_id = excluded.author_agent_id,
          version = excluded.version,
          tags_json = excluded.tags_json,
          updated_at = excluded.updated_at
      `);

      for (const space of bundle.spaces) {
        if (!space?.id || !space?.name) continue;
        insertSpace.run(
          space.id,
          space.name,
          space.icon || 'folder',
          space.createdAt || new Date().toISOString(),
          space.updatedAt || new Date().toISOString()
        );
        importedSpacesCount++;

        if (Array.isArray(space.pages)) {
          for (const page of space.pages) {
            if (!page?.id || !page?.title) continue;
            insertDoc.run(
              page.id,
              space.id,
              page.title,
              page.content || '',
              page.excerpt || null,
              page.icon || null,
              page.authorAgentId || 'import',
              page.version || 1,
              typeof page.tags === 'string' ? page.tags : JSON.stringify(page.tags || []),
              page.createdAt || new Date().toISOString(),
              page.updatedAt || new Date().toISOString()
            );
            importedDocsCount++;
          }
        }
      }
    }

    // 2. Document Revisions
    if (Array.isArray(bundle.documentRevisions)) {
      const ensureSpaceStub = db.prepare(`
        INSERT INTO spaces (id, name, icon, created_at, updated_at)
        VALUES ('default-space', 'General Space', 'folder', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `);
      const ensureDocStub = db.prepare(`
        INSERT INTO documents (id, space_id, title, content, author_agent_id, version, created_at, updated_at)
        VALUES (?, 'default-space', ?, ?, 'import', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `);
      const insertRev = db.prepare(`
        INSERT INTO document_revisions (
          id, document_id, version, title, content, author_agent_id, created_at, change_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          content = excluded.content,
          change_summary = excluded.change_summary
      `);

      const now = new Date().toISOString();
      ensureSpaceStub.run(now, now);

      for (const rev of bundle.documentRevisions) {
        if (!rev?.id || !rev?.documentId) continue;
        // Foreign key guard: ensure parent document exists
        ensureDocStub.run(
          rev.documentId,
          rev.title || 'Untitled Document',
          rev.content || '',
          rev.version || 1,
          rev.createdAt || now,
          rev.createdAt || now
        );

        insertRev.run(
          rev.id,
          rev.documentId,
          rev.version || 1,
          rev.title || '',
          rev.content || '',
          rev.authorAgentId || 'import',
          rev.createdAt || now,
          rev.changeSummary || null
        );
        importedRevisionsCount++;
      }
    }

    // 3. Missions & Tasks
    if (Array.isArray(bundle.missions)) {
      const insertMission = db.prepare(`
        INSERT INTO missions (
          id, title, objective, status, priority, assigned_agents_json, milestones_json, budget_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          objective = excluded.objective,
          status = excluded.status,
          priority = excluded.priority,
          assigned_agents_json = excluded.assigned_agents_json,
          milestones_json = excluded.milestones_json,
          budget_json = excluded.budget_json,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `);
      const insertTask = db.prepare(`
        INSERT INTO agent_tasks (
          id, mission_id, title, goal, assigned_agent_id, status, dependencies_json,
          priority, inputs_json, outputs_json, observations_json, verification_json,
          approval_id, approval_token, error, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mission_id = excluded.mission_id,
          title = excluded.title,
          goal = excluded.goal,
          assigned_agent_id = excluded.assigned_agent_id,
          status = excluded.status,
          dependencies_json = excluded.dependencies_json,
          priority = excluded.priority,
          inputs_json = excluded.inputs_json,
          outputs_json = excluded.outputs_json,
          observations_json = excluded.observations_json,
          verification_json = excluded.verification_json,
          error = excluded.error,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `);

      for (const m of bundle.missions) {
        if (!m?.id || !m?.title) continue;
        // Restored unfinished missions are placed in 'paused' to prevent uncontrolled worker auto-execution
        const safeStatus = m.status === 'active' || m.status === 'draft' ? 'paused' : (m.status || 'draft');
        insertMission.run(
          m.id,
          m.title,
          m.objective || '',
          safeStatus,
          m.priority || 'medium',
          typeof m.assignedAgents === 'string' ? m.assignedAgents : JSON.stringify(m.assignedAgents || []),
          typeof m.milestones === 'string' ? m.milestones : JSON.stringify(m.milestones || []),
          m.budget ? (typeof m.budget === 'string' ? m.budget : JSON.stringify(m.budget)) : null,
          m.createdAt || new Date().toISOString(),
          m.updatedAt || new Date().toISOString(),
          m.completedAt || null
        );
        importedMissionsCount++;

        if (Array.isArray(m.tasks)) {
          for (const t of m.tasks) {
            if (!t?.id || !t?.title) continue;
            insertTask.run(
              t.id,
              m.id,
              t.title,
              t.goal || '',
              t.assignedAgentId || 'agent-aura',
              t.status || 'pending',
              typeof t.dependencies === 'string' ? t.dependencies : JSON.stringify(t.dependencies || []),
              t.priority || 'medium',
              typeof t.inputs === 'string' ? t.inputs : JSON.stringify(t.inputs || {}),
              typeof t.outputs === 'string' ? t.outputs : JSON.stringify(t.outputs || {}),
              typeof t.observations === 'string' ? t.observations : JSON.stringify(t.observations || []),
              t.verification ? (typeof t.verification === 'string' ? t.verification : JSON.stringify(t.verification)) : null,
              t.error || null,
              t.createdAt || new Date().toISOString(),
              t.updatedAt || new Date().toISOString(),
              t.completedAt || null
            );
            importedTasksCount++;
          }
        }
      }
    }

    // Support top-level tasks if present in snapshot
    if (Array.isArray(bundle.tasks)) {
      const ensureMissionStub = db.prepare(`
        INSERT INTO missions (id, title, objective, status, priority, assigned_agents_json, milestones_json, created_at, updated_at)
        VALUES (?, 'Imported Mission', 'Imported stub', 'paused', 'medium', '[]', '[]', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `);
      const insertTask = db.prepare(`
        INSERT INTO agent_tasks (
          id, mission_id, title, goal, assigned_agent_id, status, dependencies_json,
          priority, inputs_json, outputs_json, observations_json, verification_json,
          approval_id, approval_token, error, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mission_id = excluded.mission_id,
          title = excluded.title,
          goal = excluded.goal,
          assigned_agent_id = excluded.assigned_agent_id,
          status = excluded.status,
          dependencies_json = excluded.dependencies_json,
          priority = excluded.priority,
          inputs_json = excluded.inputs_json,
          outputs_json = excluded.outputs_json,
          observations_json = excluded.observations_json,
          verification_json = excluded.verification_json,
          error = excluded.error,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `);
      const now = new Date().toISOString();
      for (const t of bundle.tasks) {
        if (!t?.id || !t?.title) continue;
        if (t.missionId) {
          ensureMissionStub.run(t.missionId, now, now);
        }
        insertTask.run(
          t.id,
          t.missionId || null,
          t.title,
          t.goal || '',
          t.assignedAgentId || 'agent-aura',
          t.status || 'pending',
          typeof t.dependencies === 'string' ? t.dependencies : JSON.stringify(t.dependencies || []),
          t.priority || 'medium',
          typeof t.inputs === 'string' ? t.inputs : JSON.stringify(t.inputs || {}),
          typeof t.outputs === 'string' ? t.outputs : JSON.stringify(t.outputs || {}),
          typeof t.observations === 'string' ? t.observations : JSON.stringify(t.observations || []),
          t.verification ? (typeof t.verification === 'string' ? t.verification : JSON.stringify(t.verification)) : null,
          t.error || null,
          t.createdAt || now,
          t.updatedAt || now,
          t.completedAt || null
        );
        importedTasksCount++;
      }
    }

    // 4. Evidence Timeline
    if (Array.isArray(bundle.evidenceTimeline)) {
      const insertEvidence = db.prepare(`
        INSERT INTO evidence_records (
          id, mission_id, task_id, agent_id, agent_name, timestamp, action_type, summary, details_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mission_id = excluded.mission_id,
          task_id = excluded.task_id,
          agent_id = excluded.agent_id,
          agent_name = excluded.agent_name,
          timestamp = excluded.timestamp,
          action_type = excluded.action_type,
          summary = excluded.summary,
          details_json = excluded.details_json,
          status = excluded.status
      `);
      for (const ev of bundle.evidenceTimeline) {
        if (!ev?.id || !ev?.agentId || !ev?.summary) continue;
        insertEvidence.run(
          ev.id,
          ev.missionId || null,
          ev.taskId || null,
          ev.agentId,
          ev.agentName || 'Agent',
          ev.timestamp || new Date().toISOString(),
          ev.actionType || 'model_call',
          ev.summary,
          typeof ev.details === 'string' ? ev.details : JSON.stringify(ev.details || {}),
          ev.status || 'success'
        );
        importedEvidenceCount++;
      }
    }

    // 5. Approvals Audit History
    if (Array.isArray(bundle.approvalsAudit)) {
      const insertApproval = db.prepare(`
        INSERT INTO approvals (
          id, agent_id, agent_name, type, title, description, target_space_id,
          payload_json, status, created_at, expires_at, single_use_token,
          decision_at, decision_reason, execution_result_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          decision_at = excluded.decision_at,
          decision_reason = excluded.decision_reason,
          execution_result_json = excluded.execution_result_json
      `);

      for (const appr of bundle.approvalsAudit) {
        if (!appr?.id) continue;
        const safeStatus = appr.status === 'pending' ? 'expired' : (appr.status || 'expired');
        const dummyToken = `expired-import-token-${crypto.randomBytes(8).toString('hex')}`;
        const title = appr.title || appr.action || appr.command || 'Privileged Operation';
        insertApproval.run(
          appr.id,
          appr.agentId || 'agent-aura',
          appr.agentName || 'Agent',
          appr.type || appr.action || 'run_command',
          title,
          appr.description || appr.reason || null,
          appr.targetSpaceId || null,
          typeof appr.payload === 'string' ? appr.payload : JSON.stringify(appr.payload || (appr.command ? { command: appr.command } : {})),
          safeStatus,
          appr.createdAt || appr.requestedAt || new Date().toISOString(),
          appr.expiresAt || new Date().toISOString(),
          dummyToken,
          appr.decisionAt || appr.decidedAt || null,
          appr.decisionReason || null,
          appr.executionResult ? (typeof appr.executionResult === 'string' ? appr.executionResult : JSON.stringify(appr.executionResult)) : null
        );
        importedApprovalsCount++;
      }
    }

    db.exec('RELEASE SAVEPOINT nook_snapshot_import;');
  } catch (err) {
    try {
      db.exec('ROLLBACK TO SAVEPOINT nook_snapshot_import;');
      db.exec('RELEASE SAVEPOINT nook_snapshot_import;');
    } catch {
      // ignore if savepoint already closed
    }
    throw err;
  }

  if (db === getDatabase()) {
    logAuditEvent('WORKSPACE_SNAPSHOT_IMPORTED', `Restored ${importedSpacesCount} spaces, ${importedDocsCount} docs, ${importedRevisionsCount} revisions, ${importedMissionsCount} missions, ${importedTasksCount} tasks, ${importedEvidenceCount} evidence logs, ${importedApprovalsCount} approvals`, 'success');
  }

  return {
    success: true,
    validation,
    importedSpacesCount,
    importedDocsCount,
    importedRevisionsCount,
    importedMissionsCount,
    importedTasksCount,
    importedEvidenceCount,
    importedApprovalsCount,
  };
}



