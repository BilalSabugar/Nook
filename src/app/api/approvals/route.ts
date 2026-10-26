import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const APPROVALS_FILE = path.join(STORAGE_DIR, 'approvals.json');

export interface ServerApprovalRecord {
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

async function loadApprovals(): Promise<Record<string, ServerApprovalRecord>> {
  try {
    const raw = await fs.readFile(APPROVALS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveApprovals(records: Record<string, ServerApprovalRecord>): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const tempFile = `${APPROVALS_FILE}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(records, null, 2), 'utf8');
  await fs.rename(tempFile, APPROVALS_FILE);
}

/**
 * GET /api/approvals
 * Returns active and pending server approvals.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const approvals = await loadApprovals();
  return NextResponse.json({
    approvals: Object.values(approvals),
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /api/approvals
 * Handles approval lifecycle:
 * - action="create": registers a new pending approval on the server with TTL and single-use token
 * - action="decide": user authorizes or declines an approval
 * - action="verify": execution service verifies and consumes single-use approval
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { action } = body;
    const approvals = await loadApprovals();

    // 1. Create a new approval request on server
    if (action === 'create' || !action) {
      const { agentId, agentName, type, title, description, targetSpaceId, payload, id: customId } = body;

      const approvalId = customId || `appr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const token = crypto.randomBytes(16).toString('hex');
      const now = Date.now();
      const expiresAt = new Date(now + 15 * 60 * 1000).toISOString(); // 15 minute TTL

      const record: ServerApprovalRecord = {
        id: approvalId,
        agentId: agentId || 'unknown-agent',
        agentName: agentName || 'Specialist',
        type: type || 'run_command',
        title: title || 'Action Authorization Request',
        description: description || '',
        targetSpaceId,
        payload: payload || {},
        status: 'pending',
        createdAt: new Date(now).toISOString(),
        expiresAt,
        singleUseToken: token,
      };

      approvals[approvalId] = record;
      await saveApprovals(approvals);

      return NextResponse.json({
        success: true,
        approval: record,
      }, { status: 201 });
    }

    // 2. Decide: User approves or declines
    if (action === 'decide') {
      const { approvalId, decision, reason } = body;
      const record = approvals[approvalId];

      if (!record) {
        return NextResponse.json({ error: `Approval ${approvalId} not found` }, { status: 404 });
      }

      if (record.status !== 'pending') {
        return NextResponse.json({
          error: `Approval ${approvalId} is already in '${record.status}' state and cannot be modified.`,
        }, { status: 400 });
      }

      // Check expiration
      if (Date.now() > Date.parse(record.expiresAt)) {
        record.status = 'declined';
        record.decisionReason = 'Expired authorization window';
        await saveApprovals(approvals);
        return NextResponse.json({ error: 'Approval request has expired' }, { status: 410 });
      }

      record.status = decision === 'approve' ? 'approved' : 'declined';
      record.decisionAt = new Date().toISOString();
      record.decisionReason = reason;

      await saveApprovals(approvals);

      return NextResponse.json({
        success: true,
        approval: record,
      });
    }

    // 3. Verify & Consume (called by server-side execution services)
    if (action === 'verify_and_consume') {
      const { approvalId, token, command, type } = body;
      const record = approvals[approvalId];

      if (!record) {
        return NextResponse.json({ error: 'Authorization error: No matching server approval record' }, { status: 403 });
      }

      if (record.status !== 'approved') {
        return NextResponse.json({
          error: `Authorization rejected: Approval is in '${record.status}' state (requires 'approved').`,
        }, { status: 403 });
      }

      // Token verification
      if (token && record.singleUseToken !== token) {
        return NextResponse.json({ error: 'Invalid single-use authorization token' }, { status: 403 });
      }

      // Action type and command verification
      if (type && record.type !== type) {
        return NextResponse.json({ error: `Approval type mismatch: expected ${record.type}, received ${type}` }, { status: 403 });
      }

      if (command && record.payload.command && record.payload.command.trim() !== command.trim()) {
        return NextResponse.json({
          error: `Authorization mismatch: Approved command does not match requested command.`,
        }, { status: 403 });
      }

      // Check TTL
      if (Date.now() > Date.parse(record.expiresAt)) {
        record.status = 'declined';
        await saveApprovals(approvals);
        return NextResponse.json({ error: 'Authorization rejected: Approval has expired' }, { status: 403 });
      }

      // Single-use enforcement: mark as consumed
      record.status = 'consumed';
      await saveApprovals(approvals);

      return NextResponse.json({
        authorized: true,
        approval: record,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
