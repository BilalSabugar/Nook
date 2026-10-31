import { NextRequest, NextResponse } from 'next/server.js';
import { validateApiRequest, validateHumanApproverRequest, unauthorizedResponse } from '../../../lib/auth.ts';
import {
  createApproval,
  listApprovals,
  decideApproval,
  verifyAndConsumeApproval,
  createApprovalExecutionGrant,
  logAuditEvent,
  redactApproval,
} from '../../../lib/db.ts';

/**
 * GET /api/approvals
 * Returns active and pending server approvals.
 * Critical security requirement: Never reveals reusable single-use tokens in ordinary listing responses.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  // Redact single-use tokens in general listings
  const approvals = listApprovals(false);

  return NextResponse.json({
    approvals,
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /api/approvals
 * Handles approval lifecycle:
 * - action="create": registers a new pending approval on the server with TTL and single-use token
 * - action="decide": user authorizes or declines an approval
 * - action="verify_and_consume": execution service verifies and atomically consumes single-use approval
 * - action="create_and_approve": interactive user session authoring
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { action } = body;

    // 1. Create a new approval request on server (pending user decision)
    if (action === 'create' || !action) {
      const { agentId, agentName, type, title, description, targetSpaceId, payload, id: customId } = body;

      const record = createApproval({
        id: customId,
        agentId: agentId || 'agent-system',
        agentName: agentName || 'System',
        type: type || 'run_command',
        title: title || 'Action Authorization Request',
        description: description || '',
        targetSpaceId,
        payload: payload || {},
      });

      return NextResponse.json({
        success: true,
        approval: redactApproval(record),
      }, { status: 201 });
    }

    // 2. Decide: User authorizes or declines
    if (action === 'decide') {
      // Human-only: machine credentials (API key, worker) can never decide approvals
      const human = validateHumanApproverRequest(req);
      if (!human.authorized) {
        logAuditEvent('APPROVAL_DECISION_DENIED', human.error || 'Not a human approver', 'denied');
        return unauthorizedResponse(human.error, human.status || 403);
      }
      const { approvalId, decision, reason } = body;

      if (!approvalId || !decision) {
        return NextResponse.json({ error: 'approvalId and decision are required' }, { status: 400 });
      }

      const outcome = decideApproval(approvalId, decision === 'approve' ? 'approve' : 'decline', reason);
      if (!outcome.success) {
        const status = outcome.error?.includes('expired') ? 410 : 400;
        return NextResponse.json({ error: outcome.error }, { status });
      }

      const executionGrant =
        outcome.approval && outcome.approval.status === 'approved'
          ? createApprovalExecutionGrant(outcome.approval, human.auth?.sessionId || 'nook-owner')
          : undefined;

      return NextResponse.json({
        success: true,
        approval: redactApproval(outcome.approval),
        ...(executionGrant ? { executionGrant } : {}),
      });
    }

    // 3. User interactive direct session execution: strictly restricted to authenticated human owner session
    if (action === 'create_and_approve') {
      const human = validateHumanApproverRequest(req);
      if (!human.authorized) {
        logAuditEvent('APPROVAL_DECISION_DENIED', human.error || 'Not a human approver', 'denied');
        return unauthorizedResponse(human.error, human.status || 403);
      }
      const { agentId, type, title, description, targetSpaceId, payload, missionId, autonomous } = body;

      // Strict security boundary: autonomous missions CANNOT auto-approve privileged operations!
      if (missionId || autonomous === true) {
        logAuditEvent('APPROVAL_BYPASS_ATTEMPT', `Blocked automated self-approval attempt: mission parameters detected`, 'denied', agentId || 'unknown');
        return NextResponse.json({
          error: 'Security violation: Autonomous agents and missions cannot auto-approve privileged commands. Review card human approval required.',
        }, { status: 403 });
      }

      const targetType = type || 'run_command';
      const rawCommand = typeof payload?.command === 'string' ? payload.command.trim() : '';
      if (targetType === 'run_command' && !rawCommand) {
        return NextResponse.json({ error: 'Command string is required in payload.command for run_command approval' }, { status: 400 });
      }

      const safeTargetAgentId = (typeof agentId === 'string' && agentId.trim() ? agentId.trim() : 'default').replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

      // Bind the interactive approval to the authenticated human session, intended target agent sandbox, and exact command
      const record = createApproval({
        agentId: safeTargetAgentId,
        agentName: 'Human Owner (Interactive Terminal)',
        type: targetType,
        title: title || 'User Interactive Execution',
        description: description || 'Executed directly by authenticated human owner in interactive terminal',
        targetSpaceId,
        payload: {
          ...(payload || {}),
          ...(rawCommand ? { command: rawCommand } : {}),
        },
      });

      const outcome = decideApproval(record.id, 'approve', 'Authorized directly by authenticated human owner session');
      const executionGrant = outcome.approval
        ? createApprovalExecutionGrant(outcome.approval, human.auth?.sessionId || 'nook-owner')
        : undefined;

      return NextResponse.json({
        success: true,
        approval: redactApproval(outcome.approval),
        ...(executionGrant ? { executionGrant } : {}),
      }, { status: 201 });
    }

    // 4. Verify & Atomically Consume (called by server-side execution services)
    if (action === 'verify_and_consume') {
      const { approvalId, token, executionGrant, command, agentId, taskId } = body;
      const presentedToken = executionGrant || token;

      if (!approvalId || !presentedToken) {
        return NextResponse.json({
          authorized: false,
          error: 'Execution denied: Mandatory approvalId and single-use authorization token required.',
        }, { status: 403 });
      }

      const outcome = verifyAndConsumeApproval(
        approvalId,
        presentedToken,
        command,
        agentId,
        typeof taskId === 'string' ? taskId : undefined,
        auth.sessionId
      );
      if (!outcome.authorized) {
        return NextResponse.json({
          authorized: false,
          error: outcome.error,
        }, { status: 403 });
      }

      return NextResponse.json({
        authorized: true,
        approval: redactApproval(outcome.approval),
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
