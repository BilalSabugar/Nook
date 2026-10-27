import crypto from 'crypto';

export interface SandboxExecutionTicket {
  ticketId: string;
  commandHash: string;
  agentId: string;
  action: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

const DEFAULT_SECRET = 'nook_internal_runner_auth_secret_v1';

export function getSandboxRunnerSecret(): string {
  return process.env.SANDBOX_RUNNER_SECRET || DEFAULT_SECRET;
}

export function computeCommandHash(command: string): string {
  return crypto.createHash('sha256').update(command.trim()).digest('hex');
}

/**
 * Creates an authenticated, short-lived, action-bound execution ticket.
 * The ticket is signed with HMAC-SHA256 and expires in 30 seconds.
 */
export function createSandboxExecutionTicket(
  command: string,
  agentId: string,
  ttlMs = 30000,
  secret = getSandboxRunnerSecret()
): SandboxExecutionTicket {
  const ticketId = crypto.randomUUID();
  const commandHash = computeCommandHash(command);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  const action = 'sandboxed_exec';

  const payload = `${ticketId}:${commandHash}:${agentId}:${issuedAt}:${expiresAt}:${action}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  return {
    ticketId,
    commandHash,
    agentId,
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
  secret = getSandboxRunnerSecret()
): { valid: boolean; error?: string } {
  if (!ticket || !ticket.ticketId || !ticket.signature) {
    return { valid: false, error: 'Malformed or missing execution ticket fields' };
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
  const payload = `${ticket.ticketId}:${ticket.commandHash}:${ticket.agentId}:${ticket.issuedAt}:${ticket.expiresAt}:${ticket.action}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

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

  return { valid: true };
}
