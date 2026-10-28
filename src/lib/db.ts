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

export function listApprovals(includeSecretTokens: boolean = false): DbApprovalRecord[] {
  const db = getDatabase();
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

export function saveSpace(space: { id: string; name: string; icon: string }): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO spaces (id, name, icon, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, updated_at = excluded.updated_at
  `).run(space.id, space.name, space.icon, now, now);
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
  const existing = db.prepare(`SELECT version FROM documents WHERE id = ?`).get(doc.id) as unknown as { version: number } | undefined;
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

  return saveDocumentWithRevision({
    id: documentId,
    spaceId: rev.document_id, // falls back in transaction
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

  db.prepare(`
    INSERT INTO missions (
      id, title, objective, status, priority, assigned_agents_json, milestones_json, budget_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    mission.title,
    mission.objective,
    mission.priority || 'medium',
    JSON.stringify(assignedAgents),
    JSON.stringify(milestones),
    JSON.stringify(mission.budget || { maxToolCalls: 20, usedToolCalls: 0 }),
    now,
    now
  );

  logAuditEvent('MISSION_CREATED', `Mission '${mission.title}' (${id}) created`, 'success', 'agent-aura');

  return {
    id,
    title: mission.title,
    objective: mission.objective,
    status: 'draft',
    priority: mission.priority || 'medium',
    assignedAgents,
    milestones,
    budget: mission.budget,
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
    JSON.stringify(task.inputs || {}),
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
    inputs: task.inputs || {},
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
  const outputs = update.outputs ? { ...existing.outputs, ...update.outputs } : existing.outputs;
  const completedAt = status === 'completed' || status === 'failed' ? now : existing.completedAt;

  db.prepare(`
    UPDATE agent_tasks
    SET status = ?, outputs_json = ?, error = ?, approval_id = ?, approval_token = ?, updated_at = ?, completed_at = ?
    WHERE id = ?
  `).run(
    status,
    JSON.stringify(outputs),
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
    input: obs.input,
    output: obs.output,
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

  // Sanitize details: strip secrets if present
  const safeDetails = { ...(record.details || {}) };
  for (const k of Object.keys(safeDetails)) {
    if (k.toLowerCase().includes('key') || k.toLowerCase().includes('token') || k.toLowerCase().includes('secret')) {
      safeDetails[k] = '[REDACTED]';
    }
  }

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

// ==========================================
// SOVEREIGN WORKSPACE EXPORT & IMPORT (v2)
// ==========================================

export function exportWorkspaceSnapshot(db: DatabaseSync = getDatabase()): {
  nookVersion: string;
  exportedAt: string;
  schemaVersion: number;
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
      approvalToken: undefined, // NEVER export single-use tokens!
      error: r.error || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || undefined,
    }));

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
    summary: r.summary,
    details: JSON.parse(r.details_json || '{}'),
    status: r.status as DbEvidenceRecord['status'],
  }));

  const approvalsAudit = listApprovals(false);

  return {
    nookVersion: '1.2.0',
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    spaces,
    documentRevisions,
    missions,
    evidenceTimeline,
    approvalsAudit,
  };
}

export function importWorkspaceSnapshot(
  bundle: any,
  db: DatabaseSync = getDatabase()
): {
  success: boolean;
  importedSpacesCount: number;
  importedDocsCount: number;
  importedRevisionsCount: number;
  importedMissionsCount: number;
  importedTasksCount: number;
  importedEvidenceCount: number;
} {
  if (!bundle || typeof bundle !== 'object' || !bundle.schemaVersion) {
    throw new Error('Invalid workspace bundle: Missing schemaVersion');
  }

  let importedSpacesCount = 0;
  let importedDocsCount = 0;
  let importedRevisionsCount = 0;
  let importedMissionsCount = 0;
  let importedTasksCount = 0;
  let importedEvidenceCount = 0;

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Spaces & Documents
    if (Array.isArray(bundle.spaces)) {
      const insertSpace = db.prepare(`
        INSERT OR IGNORE INTO spaces (id, name, icon, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
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
        WHERE excluded.version >= documents.version
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
              JSON.stringify(page.tags || []),
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
      const insertRev = db.prepare(`
        INSERT OR IGNORE INTO document_revisions (
          id, document_id, version, title, content, author_agent_id, created_at, change_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rev of bundle.documentRevisions) {
        if (!rev?.id || !rev?.documentId) continue;
        insertRev.run(
          rev.id,
          rev.documentId,
          rev.version || 1,
          rev.title || '',
          rev.content || '',
          rev.authorAgentId || 'import',
          rev.createdAt || new Date().toISOString(),
          rev.changeSummary || null
        );
        importedRevisionsCount++;
      }
    }

    // 3. Missions & Tasks
    if (Array.isArray(bundle.missions)) {
      const insertMission = db.prepare(`
        INSERT OR IGNORE INTO missions (
          id, title, objective, status, priority, assigned_agents_json, milestones_json, budget_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertTask = db.prepare(`
        INSERT OR IGNORE INTO agent_tasks (
          id, mission_id, title, goal, assigned_agent_id, status, dependencies_json,
          priority, inputs_json, outputs_json, observations_json, verification_json,
          approval_id, approval_token, error, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
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
          JSON.stringify(m.assignedAgents || []),
          JSON.stringify(m.milestones || []),
          m.budget ? JSON.stringify(m.budget) : null,
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
              JSON.stringify(t.dependencies || []),
              t.priority || 'medium',
              JSON.stringify(t.inputs || {}),
              JSON.stringify(t.outputs || {}),
              JSON.stringify(t.observations || []),
              t.verification ? JSON.stringify(t.verification) : null,
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

    // 4. Evidence Timeline
    if (Array.isArray(bundle.evidenceTimeline)) {
      const insertEvidence = db.prepare(`
        INSERT OR IGNORE INTO evidence_records (
          id, mission_id, task_id, agent_id, agent_name, timestamp, action_type, summary, details_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  logAuditEvent('WORKSPACE_SNAPSHOT_IMPORTED', `Restored ${importedSpacesCount} spaces, ${importedDocsCount} docs, ${importedRevisionsCount} revisions, ${importedMissionsCount} missions, ${importedTasksCount} tasks, ${importedEvidenceCount} evidence logs`, 'success');

  return {
    success: true,
    importedSpacesCount,
    importedDocsCount,
    importedRevisionsCount,
    importedMissionsCount,
    importedTasksCount,
    importedEvidenceCount,
  };
}



