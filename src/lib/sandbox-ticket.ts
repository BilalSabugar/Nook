import crypto from 'crypto';

export interface SandboxExecutionTicket {
  ticketId: string;
  commandHash: string;
  agentId: string;
  taskId: string;
  approvalId?: string;
  authorizationType: 'human_approval' | 'system_verified_test';
  action: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface CreateTicketOptions {
  command: string;
  agentId: string;
  taskId?: string;
  approvalId?: string;
  authorizationType?: 'human_approval' | 'system_verified_test';
  ttlMs?: number;
  secret?: string;
}

const INSECURE_DEFAULT_SECRETS = new Set([
  'nook_internal_runner_auth_secret_v1',
  'test-audit-runner-secret-key-32bytes',
  'default',
  'secret',
  'change-me',
]);

// Ephemeral runtime secret generated per-process instance when none configured in dev/test
let _ephemeralRunnerSecret: string | null = null;

export function getSandboxRunnerSecret(): string {
  const envSecret = process.env.SANDBOX_RUNNER_SECRET?.trim();

  if (envSecret) {
    if (INSECURE_DEFAULT_SECRETS.has(envSecret)) {
      throw new Error(
        'SECURITY FAULT: SANDBOX_RUNNER_SECRET is set to an insecure, publicly known default value. A unique high-entropy secret is strictly required.'
      );
    }
    if (envSecret.length < 16) {
      throw new Error(
        'SECURITY FAULT: SANDBOX_RUNNER_SECRET is too short (< 16 characters). High-entropy cryptographic secret required.'
      );
    }
    return envSecret;
  }

  // In production, missing secret must fail closed immediately
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: SANDBOX_RUNNER_SECRET must be explicitly configured in production. Execution authorization refused.'
    );
  }

  // Development & test: generate cryptographically secure ephemeral random secret
  if (!_ephemeralRunnerSecret) {
    _ephemeralRunnerSecret = crypto.randomBytes(32).toString('hex');
  }
  return _ephemeralRunnerSecret;
}

export function computeCommandHash(command: string): string {
  return crypto.createHash('sha256').update(command.trim()).digest('hex');
}

/**
 * Creates an authenticated, short-lived, action-bound execution ticket.
 * The ticket is signed with HMAC-SHA256 and expires in 30 seconds.
 */
export function createSandboxExecutionTicket(
  commandOrOptions: string | CreateTicketOptions,
  agentId?: string,
  ttlMs = 30000,
  secret?: string
): SandboxExecutionTicket {
  let command: string;
  let safeAgentId: string;
  let taskId: string;
  let approvalId: string | undefined;
  let authorizationType: 'human_approval' | 'system_verified_test';
  let ttl: number;
  let signingSecret: string;

  if (typeof commandOrOptions === 'object') {
    command = commandOrOptions.command;
    safeAgentId = commandOrOptions.agentId;
    taskId = commandOrOptions.taskId || crypto.randomUUID();
    approvalId = commandOrOptions.approvalId;
    authorizationType = commandOrOptions.authorizationType || (approvalId ? 'human_approval' : 'system_verified_test');
    ttl = commandOrOptions.ttlMs ?? 30000;
    signingSecret = commandOrOptions.secret || getSandboxRunnerSecret();
  } else {
    command = commandOrOptions;
    safeAgentId = agentId || 'default';
    taskId = crypto.randomUUID();
    approvalId = undefined;
    authorizationType = 'system_verified_test';
    ttl = ttlMs;
    signingSecret = secret || getSandboxRunnerSecret();
  }

  const ticketId = crypto.randomUUID();
  const commandHash = computeCommandHash(command);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttl;
  const action = 'sandboxed_exec';

  const payload = `${ticketId}:${commandHash}:${safeAgentId}:${taskId}:${approvalId || 'none'}:${authorizationType}:${issuedAt}:${expiresAt}:${action}`;
  const signature = crypto.createHmac('sha256', signingSecret).update(payload).digest('hex');

  return {
    ticketId,
    commandHash,
    agentId: safeAgentId,
    taskId,
    approvalId,
    authorizationType,
    action,
    issuedAt,
    expiresAt,
    signature,
  };
}

/**
 * Validates an execution ticket against parameters, checking signature, expiry, and replay protection.
 */
export function verifySandboxExecutionTicket(
  ticket: SandboxExecutionTicket,
  command: string,
  agentId: string,
  consumedTicketIds?: Set<string> | Map<string, number>,
  secret?: string
): { valid: boolean; error?: string } {
  if (!ticket || !ticket.ticketId || !ticket.signature) {
    return { valid: false, error: 'Malformed or missing execution ticket fields' };
  }

  let verifyingSecret: string;
  try {
    verifyingSecret = secret || getSandboxRunnerSecret();
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Runner secret configuration error' };
  }

  const now = Date.now();
  if (now > ticket.expiresAt) {
    return { valid: false, error: 'Execution ticket has expired' };
  }

  if (ticket.issuedAt > now + 5000) {
    return { valid: false, error: 'Execution ticket has future timestamp' };
  }

  if (ticket.expiresAt - ticket.issuedAt > 60000) {
    return { valid: false, error: 'Execution ticket TTL exceeds maximum allowed 60 seconds' };
  }

  if (ticket.action !== 'sandboxed_exec') {
    return { valid: false, error: 'Execution ticket action mismatch' };
  }

  // Replay protection check
  if (consumedTicketIds) {
    if (consumedTicketIds instanceof Set) {
      if (consumedTicketIds.has(ticket.ticketId)) {
        return { valid: false, error: 'Execution ticket has already been consumed (replay detected)' };
      }
    } else if (consumedTicketIds instanceof Map) {
      if (consumedTicketIds.has(ticket.ticketId)) {
        return { valid: false, error: 'Execution ticket has already been consumed (replay detected)' };
      }
    }
  }

  // Verify HMAC signature
  const payload = `${ticket.ticketId}:${ticket.commandHash}:${ticket.agentId}:${ticket.taskId || ''}:${ticket.approvalId || 'none'}:${ticket.authorizationType || 'system_verified_test'}:${ticket.issuedAt}:${ticket.expiresAt}:${ticket.action}`;
  const expectedSig = crypto.createHmac('sha256', verifyingSecret).update(payload).digest('hex');

  const sigBuf = Buffer.from(ticket.signature, 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'Execution ticket cryptographic signature is invalid' };
  }

  // Verify bound command
  const expectedCommandHash = computeCommandHash(command);
  if (ticket.commandHash !== expectedCommandHash) {
    return { valid: false, error: 'Execution ticket is bound to a different command' };
  }

  // Verify bound agent
  if (ticket.agentId !== agentId) {
    return { valid: false, error: 'Execution ticket is bound to a different agent' };
  }

  // Verify authorization chain
  if (ticket.authorizationType === 'human_approval' && !ticket.approvalId) {
    return { valid: false, error: 'Human approval authorization type requires bound approvalId' };
  }

  return { valid: true };
}
