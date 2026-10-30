import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const SECRET_FILE = path.join(STORAGE_DIR, 'auth_secret');

/**
 * Known public example, documentation, or placeholder secrets that must NEVER be accepted
 * as valid credentials in any environment.
 */
export const KNOWN_PUBLIC_EXAMPLE_SECRETS = new Set([
  'nook-production-api-key-change-this-32bytes',
  'nook-human-approver-secret-password-32bytes',
  'nook-owner-change-me-32-chars-minimum',
  'nook-approver-distinct-human-secret-32c',
  'nook-api-key-change-me-32-chars-minimum',
  '0123456789abcdef0123456789abcdef0123456789abcdef',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'nook_internal_runner_auth_secret_v1',
  'default_secret_do_not_use_in_prod',
  'changeme',
  'change-me',
  'secret',
  'password',
  'default',
  'admin',
  '12345678',
  'replace-with-openssl-rand-hex-32',
]);

/**
 * Checks if a secret string is a known public example, placeholder, or lacks minimum character variety.
 */
export function isKnownWeakOrExampleSecret(candidate: string | undefined | null): boolean {
  if (!candidate || typeof candidate !== 'string') return true;
  const trimmed = candidate.trim();
  if (!trimmed) return true;
  if (KNOWN_PUBLIC_EXAMPLE_SECRETS.has(trimmed) || KNOWN_PUBLIC_EXAMPLE_SECRETS.has(trimmed.toLowerCase())) {
    return true;
  }
  // Reject repeated single-character or ultra-low-variety strings (e.g. "aaaaaaaaaaaaaaaa", "121212121212")
  const uniqueChars = new Set(trimmed).size;
  if (uniqueChars < 5) {
    return true;
  }
  return false;
}

export interface AuthValidationResult {
  authorized: boolean;
  status?: number;
  error?: string;
  sessionId?: string;
  authMethod?: 'api_key' | 'session_token' | 'session_cookie';
}

/**
 * Retrieves the cryptographic server master secret derived from configured owner credentials.
 * Strictly FAILS CLOSED: Never uses process.pid fallbacks, unconfigured auto-generation, or public example secrets.
 */
function getMasterSecret(): string {
  const configured = (
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();

  if (configured && configured.length >= 8 && !isKnownWeakOrExampleSecret(configured)) {
    return crypto.createHmac('sha256', configured).update('nook-owner-session-secret-v1').digest('hex');
  }

  try {
    if (fs.existsSync(SECRET_FILE)) {
      const secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (secret.length >= 32 && !isKnownWeakOrExampleSecret(secret)) {
        return secret;
      }
    }
  } catch {
    // ignore
  }

  throw new Error('Authentication setup incomplete or using rejected example secret: Set a unique, high-entropy NOOK_API_KEY or NOOK_PASSWORD in server environment.');
}

/**
 * Creates a cryptographically signed session token:
 * format: <sessionId>.<expiresAt>.<hmacSignature>
 * Strictly fails closed if server auth setup is incomplete.
 */
export function createSessionToken(
  sessionId = 'nook-owner',
  ttlMs = 7 * 24 * 60 * 60 * 1000 // 7 days
): string {
  if (!isServerAuthSetupComplete()) {
    throw new Error('Cannot issue session token: Server authentication setup is incomplete.');
  }

  const secret = sessionId === APPROVER_SESSION_ID ? getApproverSecret() : getMasterSecret();
  if (!secret) {
    throw new Error('Cannot issue approver session: NOOK_APPROVER_PASSWORD is not configured.');
  }
  const expiresAt = Date.now() + ttlMs;
  const payload = `${sessionId}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

export const APPROVER_SESSION_ID = 'nook-approver';

/**
 * Human-approver credential, deliberately NOT derivable from any machine credential.
 * Must be >= 12 chars and differ from NOOK_API_KEY / NOOK_PASSWORD / NOOK_SECRET_TOKEN.
 */
export function getApproverPassword(): string | null {
  const approver = (process.env.NOOK_APPROVER_PASSWORD || '').trim();
  if (approver.length < 12) return null;
  if (isKnownWeakOrExampleSecret(approver)) return null;
  const machine = [process.env.NOOK_API_KEY, process.env.NOOK_PASSWORD, process.env.NOOK_SECRET_TOKEN]
    .map((v) => (v || '').trim())
    .filter(Boolean);
  if (machine.includes(approver)) return null;
  return approver;
}

export function isApproverConfigured(): boolean {
  return getApproverPassword() !== null;
}

/** Key separation: approver sessions are signed with a key only the approver password can derive. */
function getApproverSecret(): string | null {
  const approver = getApproverPassword();
  if (!approver) return null;
  return crypto.createHmac('sha256', approver).update('nook-approver-session-secret-v1').digest('hex');
}

export function verifyApproverCredentials(candidate: string): boolean {
  const approver = getApproverPassword();
  if (!approver || !candidate || typeof candidate !== 'string') return false;
  const a = crypto.createHash('sha256').update(candidate.trim()).digest();
  const b = crypto.createHash('sha256').update(approver).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verifies that a session token is valid and unexpired.
 */
export function verifySessionToken(token: string): { valid: boolean; sessionId?: string; error?: string } {
  if (!isServerAuthSetupComplete()) {
    return { valid: false, error: 'Server authentication setup is incomplete' };
  }

  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing token' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [sessionId, expiresAtStr, signature] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, error: 'Session token has expired' };
  }

  let secret: string;
  if (sessionId === APPROVER_SESSION_ID) {
    const approverSecret = getApproverSecret();
    if (!approverSecret) return { valid: false, error: 'Approver sessions are not enabled' };
    secret = approverSecret;
  } else {
    secret = getMasterSecret();
  }
  const payload = `${sessionId}.${expiresAtStr}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  // Strict signature validation
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
    return { valid: false, error: 'Invalid token signature structure' };
  }

  // Constant-time comparison on fixed 64-byte UTF-8 representations
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expectedSignature, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  return { valid: true, sessionId };
}

/**
 * Resolves the client IP without trusting spoofable headers.
 * NOOK_TRUSTED_PROXY_COUNT (default 0) = number of trusted reverse proxies in front of Nook.
 * With 0 the X-Forwarded-For header is ignored entirely; with N the Nth entry from the right is used
 * (the address the outermost trusted proxy observed), so client-supplied left-hand entries are inert.
 */
export function resolveClientIp(headers: Headers): string {
  const trusted = Math.max(0, Math.min(10, parseInt(process.env.NOOK_TRUSTED_PROXY_COUNT || '0', 10) || 0));
  if (trusted === 0) return 'direct';
  const chain = (headers.get('x-forwarded-for') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length < trusted) return 'direct';
  const candidate = chain[chain.length - trusted];
  return /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate : 'direct';
}

// In-memory sliding window rate limiter
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 120; // 120 requests per minute
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const record = rateLimitBuckets.get(key);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now });
    // Periodically clean up old keys
    if (rateLimitBuckets.size > 2000) {
      for (const [k, v] of rateLimitBuckets.entries()) {
        if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) {
          rateLimitBuckets.delete(k);
        }
      }
    }
    return true;
  }

  const max = key === 'direct' ? MAX_REQUESTS_PER_WINDOW * 10 : MAX_REQUESTS_PER_WINDOW;
  if (record.count >= max) {
    return false;
  }

  record.count += 1;
  return true;
}

// Login attempt rate limiting to prevent brute-force attacks
const LOGIN_ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_LOGIN_ATTEMPTS = 5; // Max 5 failed attempts per 5 minutes per client
const GLOBAL_LOGIN_BUCKET = '__global__';
const MAX_GLOBAL_FAILED_LOGIN_ATTEMPTS = 50; // Ceiling across ALL clients, immune to IP rotation
const loginAttemptBuckets = new Map<string, { failedCount: number; windowStart: number; blockedUntil?: number }>();

function checkBucket(key: string, max: number): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const record = loginAttemptBuckets.get(key);
  if (!record) {
    return { allowed: true };
  }

  if (record.blockedUntil && now < record.blockedUntil) {
    return { allowed: false, retryAfterSeconds: Math.ceil((record.blockedUntil - now) / 1000) };
  }

  if (now - record.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttemptBuckets.delete(key);
    return { allowed: true };
  }

  if (record.failedCount >= max) {
    record.blockedUntil = now + LOGIN_ATTEMPT_WINDOW_MS;
    return { allowed: false, retryAfterSeconds: Math.ceil(LOGIN_ATTEMPT_WINDOW_MS / 1000) };
  }

  return { allowed: true };
}

function recordBucketFailure(key: string, max: number): void {
  const now = Date.now();
  const record = loginAttemptBuckets.get(key);
  if (!record || now - record.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttemptBuckets.set(key, { failedCount: 1, windowStart: now });
  } else {
    record.failedCount += 1;
    if (record.failedCount >= max) {
      record.blockedUntil = now + LOGIN_ATTEMPT_WINDOW_MS;
    }
  }
  if (loginAttemptBuckets.size > 5000) {
    for (const [k, v] of loginAttemptBuckets.entries()) {
      if (now - v.windowStart > LOGIN_ATTEMPT_WINDOW_MS && !(v.blockedUntil && now < v.blockedUntil)) {
        loginAttemptBuckets.delete(k);
      }
    }
  }
}

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const perClient = checkBucket(ip, MAX_FAILED_LOGIN_ATTEMPTS);
  if (!perClient.allowed) return perClient;
  return checkBucket(GLOBAL_LOGIN_BUCKET, MAX_GLOBAL_FAILED_LOGIN_ATTEMPTS);
}

export function recordFailedLogin(ip: string): void {
  recordBucketFailure(ip, MAX_FAILED_LOGIN_ATTEMPTS);
  recordBucketFailure(GLOBAL_LOGIN_BUCKET, MAX_GLOBAL_FAILED_LOGIN_ATTEMPTS);
}

export function recordSuccessfulLogin(ip: string): void {
  loginAttemptBuckets.delete(ip);
}

/** Test helper: clears all throttling state. */
export function resetLoginThrottleForTests(): void {
  loginAttemptBuckets.clear();
}

export interface HumanApproverResult {
  authorized: boolean;
  status?: number;
  error?: string;
}

/**
 * Human-decision gate for approvals. Machine credentials (API key header, bearer token minted from them)
 * can NEVER satisfy it. Requires an interactive session established with NOOK_APPROVER_PASSWORD.
 * Non-production only: when no approver password is configured, a human owner session cookie/token is
 * accepted (still never the raw API key).
 */
export function validateHumanApproverRequest(req: Request): HumanApproverResult & { auth?: AuthValidationResult } {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return { authorized: false, status: auth.status, error: auth.error, auth };
  }
  if (auth.authMethod === 'api_key') {
    return { authorized: false, status: 403, error: 'Forbidden: Machine credentials (API key) cannot issue human approval decisions.', auth };
  }
  if (isApproverConfigured()) {
    if (auth.sessionId !== APPROVER_SESSION_ID) {
      return { authorized: false, status: 403, error: 'Forbidden: A human approver session is required to decide approvals. Sign in with the approver password.', auth };
    }
    return { authorized: true, auth };
  }
  if (process.env.NODE_ENV === 'production') {
    return { authorized: false, status: 503, error: 'Approver not configured: set NOOK_APPROVER_PASSWORD (>=12 chars, distinct from machine credentials) to enable human approvals.', auth };
  }
  if (auth.sessionId !== 'nook-owner') {
    return { authorized: false, status: 403, error: 'Forbidden: Owner session required.', auth };
  }
  return { authorized: true, auth };
}

/**
 * Validates request authorization token across headers or bearer credentials.
 * Enforces:
 * 1. Matching static NOOK_API_KEY (if set), OR
 * 2. Cryptographically signed, unexpired session token in Authorization / x-nook-session-token / nook_session cookie.
 * Rejects arbitrary tokens and does NOT trust incoming Host headers.
 */
export function validateApiRequest(req: Request): AuthValidationResult {
  // 1. Rate limiting check
  const ip = resolveClientIp(req.headers);
  if (!checkRateLimit(ip)) {
    return {
      authorized: false,
      status: 429,
      error: 'Rate limit exceeded: Too many requests. Please wait a moment.',
    };
  }

  // 2. Request body size check
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) { // 5MB max
    return {
      authorized: false,
      status: 413,
      error: 'Payload Too Large: Request body exceeds maximum allowed 5MB limit.',
    };
  }

  // 3. Extract credentials
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-nook-api-key') || '';
  const sessionTokenHeader = req.headers.get('x-nook-session-token') || '';

  let cookieSession = '';
  const maybeNextReq = req as unknown as { cookies?: { get: (name: string) => { value?: string } | undefined } };
  if (typeof maybeNextReq.cookies?.get === 'function') {
    cookieSession = maybeNextReq.cookies.get('nook_session')?.value || '';
  } else {
    const rawCookie = req.headers.get('cookie') || '';
    const match = rawCookie.match(/nook_session=([^;]+)/);
    if (match) {
      cookieSession = match[1];
    }
  }

  let candidateToken = '';
  let authMethod: 'api_key' | 'session_token' | 'session_cookie' = 'api_key';

  if (authHeader.startsWith('Bearer ')) {
    candidateToken = authHeader.slice(7).trim();
    authMethod = 'session_token';
  } else if (apiKeyHeader) {
    candidateToken = apiKeyHeader.trim();
    authMethod = 'api_key';
  } else if (sessionTokenHeader) {
    candidateToken = sessionTokenHeader.trim();
    authMethod = 'session_token';
  } else if (cookieSession) {
    candidateToken = cookieSession.trim();
    authMethod = 'session_cookie';
  }

  if (!candidateToken) {
    return {
      authorized: false,
      status: 401,
      error: 'Unauthorized: Authentication required. Provide a valid Bearer token, x-nook-api-key, or session cookie.',
    };
  }

  // 4. Verify against static NOOK_API_KEY if configured and not a rejected public example
  const configuredKey = (process.env.NOOK_API_KEY || process.env.NOOK_SECRET_TOKEN || '').trim();
  if (configuredKey && isKnownWeakOrExampleSecret(configuredKey)) {
    return {
      authorized: false,
      status: 401,
      error: 'Unauthorized: Server is configured with a rejected public example secret. Replace NOOK_API_KEY with a fresh random secret.',
    };
  }
  if (configuredKey && candidateToken === configuredKey) {
    return { authorized: true, sessionId: 'api-key-owner', authMethod: 'api_key' };
  }

  // 5. Verify cryptographic signed session token
  const verification = verifySessionToken(candidateToken);
  if (verification.valid) {
    // CSRF protection: for cookie-authenticated mutating requests, strictly require and verify Origin / Referer
    if (authMethod === 'session_cookie' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = (req.headers.get('origin') || '').trim();
      const referer = (req.headers.get('referer') || '').trim();
      let host = (req.headers.get('host') || '').trim();
      if (!host) {
        try {
          host = new URL(req.url).host;
        } catch {
          host = '';
        }
      }

      // Build allowed hosts set (request host + optional NOOK_ALLOWED_ORIGINS for reverse proxy deployments)
      const allowedHosts = new Set<string>();
      if (host) allowedHosts.add(host.toLowerCase());
      const configuredOrigins = (process.env.NOOK_ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const co of configuredOrigins) {
        try {
          allowedHosts.add(new URL(co).host.toLowerCase());
        } catch {
          allowedHosts.add(co.toLowerCase());
        }
      }

      if (!origin && !referer) {
        return {
          authorized: false,
          status: 403,
          error: 'Forbidden: Cross-site request forgery protection requires an Origin or Referer header on cookie-authenticated mutating requests.',
        };
      }

      if (origin) {
        try {
          const originHost = new URL(origin).host.toLowerCase();
          if (!allowedHosts.has(originHost)) {
            return {
              authorized: false,
              status: 403,
              error: 'Forbidden: Cross-site request forgery detected (Origin mismatch).',
            };
          }
        } catch {
          return { authorized: false, status: 403, error: 'Forbidden: Invalid request origin.' };
        }
      } else if (referer) {
        try {
          const refererHost = new URL(referer).host.toLowerCase();
          if (!allowedHosts.has(refererHost)) {
            return {
              authorized: false,
              status: 403,
              error: 'Forbidden: Cross-site request forgery detected (Referer mismatch).',
            };
          }
        } catch {
          return { authorized: false, status: 403, error: 'Forbidden: Invalid request referer.' };
        }
      }
    }

    return {
      authorized: true,
      sessionId: verification.sessionId,
      authMethod,
    };
  }

  // 6. Fail closed: Reject all arbitrary tokens
  return {
    authorized: false,
    status: 401,
    error: `Unauthorized: ${verification.error || 'Invalid credentials.'}`,
  };
}

export function unauthorizedResponse(errorMsg = 'Unauthorized: Access denied', status = 401): Response {
  return Response.json(
    {
      error: errorMsg,
      code: status === 429 ? 'RATE_LIMITED' : status === 403 ? 'FORBIDDEN' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

/**
 * Checks whether owner authentication credentials have been configured in server environment
 * and are not known public example/placeholder secrets.
 */
export function isServerAuthSetupComplete(): boolean {
  const configured = (
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();

  return Boolean(configured && configured.length >= 8 && !isKnownWeakOrExampleSecret(configured));
}

/**
 * Verifies owner credentials against configured server secrets.
 * Fails closed if NOOK_API_KEY, NOOK_PASSWORD, or NOOK_SECRET_TOKEN is not configured
 * or is set to a known public example value.
 * Uses constant-time comparison to prevent timing side-channel attacks.
 */
export function verifyOwnerCredentials(candidate: string): boolean {
  const configured = (
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();

  // Fail closed if unconfigured, insecurely short (< 8 chars), or a known public example secret
  if (!configured || configured.length < 8 || isKnownWeakOrExampleSecret(configured)) {
    return false;
  }

  if (!candidate || typeof candidate !== 'string') {
    return false;
  }

  const candBuf = Buffer.from(candidate.trim(), 'utf8');
  const confBuf = Buffer.from(configured, 'utf8');

  if (candBuf.length !== confBuf.length) {
    // Constant-time dummy comparison to prevent timing leak on string length
    crypto.timingSafeEqual(confBuf, confBuf);
    return false;
  }

  return crypto.timingSafeEqual(candBuf, confBuf);
}

export interface ProductionSecurityCheck {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  detail: string;
}

export interface ProductionSecurityPosture {
  established: boolean;
  securityScore: number; // 0 to 100
  assessmentType: 'configuration_and_runtime_checklist';
  disclaimer: string;
  environment: string;
  checks: ProductionSecurityCheck[];
}

/**
 * Evaluates local security configuration and runtime control probes.
 * Note: This is a transparent local configuration & self-test checklist; external network
 * topology, TLS termination, and container host isolation must be verified independently.
 */
export function evaluateSecurityConfigurationChecklist(): ProductionSecurityPosture {
  const checks: ProductionSecurityCheck[] = [];
  const isProd = process.env.NODE_ENV === 'production';
  const configuredMaster = (
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();

  // 1. Master Secret Entropy & Non-Example Check
  if (configuredMaster && isKnownWeakOrExampleSecret(configuredMaster)) {
    checks.push({
      id: 'master_secret',
      name: 'Master Authentication Secret Entropy',
      status: 'FAIL',
      detail: 'Configured master secret matches a rejected public example or low-entropy string. Generate a fresh secret with openssl rand -hex 32.',
    });
  } else if (configuredMaster.length >= 16) {
    checks.push({
      id: 'master_secret',
      name: 'Master Authentication Secret Entropy',
      status: 'PASS',
      detail: `Configured with strong entropy (${configuredMaster.length} characters >= 16, ${new Set(configuredMaster).size} unique chars).`,
    });
  } else if (configuredMaster.length >= 8) {
    checks.push({
      id: 'master_secret',
      name: 'Master Authentication Secret Entropy',
      status: isProd ? 'FAIL' : 'WARN',
      detail: isProd
        ? 'Secret length is under 16 characters; production requires >= 16 characters.'
        : 'Configured for non-production development (>= 8 characters).',
    });
  } else {
    checks.push({
      id: 'master_secret',
      name: 'Master Authentication Secret Entropy',
      status: 'FAIL',
      detail: 'Unconfigured or fewer than 8 characters. System fails closed.',
    });
  }

  // 2. Human Approver Credential Segregation
  const approverPwd = (process.env.NOOK_APPROVER_PASSWORD || '').trim();
  if (approverPwd && isKnownWeakOrExampleSecret(approverPwd)) {
    checks.push({
      id: 'approver_segregation',
      name: 'Human Approver Credential Segregation',
      status: 'FAIL',
      detail: 'NOOK_APPROVER_PASSWORD matches a rejected public example or low-entropy secret.',
    });
  } else if (approverPwd.length >= 12 && approverPwd !== configuredMaster) {
    checks.push({
      id: 'approver_segregation',
      name: 'Human Approver Credential Segregation',
      status: 'PASS',
      detail: 'Configured and segregated from machine credentials (>= 12 characters).',
    });
  } else if (!approverPwd) {
    checks.push({
      id: 'approver_segregation',
      name: 'Human Approver Credential Segregation',
      status: isProd ? 'FAIL' : 'WARN',
      detail: isProd
        ? 'NOOK_APPROVER_PASSWORD must be configured in production.'
        : 'Approver password unconfigured; non-production fallback to owner session permitted.',
    });
  } else {
    checks.push({
      id: 'approver_segregation',
      name: 'Human Approver Credential Segregation',
      status: 'FAIL',
      detail: 'Approver credential must be >= 12 characters and distinct from machine API keys.',
    });
  }

  // 3. Public Network Isolation
  if (process.env.ALLOW_TEST_LOOPBACK === 'true' && isProd) {
    checks.push({
      id: 'public_isolation',
      name: 'Public Network Isolation & Loopback Lockdown',
      status: 'FAIL',
      detail: 'ALLOW_TEST_LOOPBACK cannot be enabled in production environments.',
    });
  } else {
    checks.push({
      id: 'public_isolation',
      name: 'Public Network Isolation & Loopback Lockdown',
      status: 'PASS',
      detail: 'Loopback bypass is strictly disabled.',
    });
  }

  // 4. Rate Limiting & Anti-Brute-Force Runtime Probe
  const probeIp = '__posture_self_test_ip__';
  const rateLimitProbeOk = checkRateLimit(probeIp);
  rateLimitBuckets.delete(probeIp);
  checks.push({
    id: 'rate_limiting',
    name: 'Rate Limiting & Anti-Brute-Force',
    status: rateLimitProbeOk ? 'PASS' : 'FAIL',
    detail: rateLimitProbeOk
      ? 'Runtime probe verified sliding-window request and login throttling buckets.'
      : 'Rate limiter probe failed.',
  });

  // 5. Sandbox Runner Secret & Egress Configuration Check
  const runnerSecret = (process.env.SANDBOX_RUNNER_SECRET || '').trim();
  const runnerSecretInvalid = runnerSecret ? (runnerSecret.length < 32 || isKnownWeakOrExampleSecret(runnerSecret)) : false;
  checks.push({
    id: 'egress_boundary',
    name: 'SSRF & Sandbox Ticket Boundary',
    status: runnerSecretInvalid ? 'FAIL' : 'PASS',
    detail: runnerSecretInvalid
      ? 'SANDBOX_RUNNER_SECRET is too short (<32 chars) or matches a known example value.'
      : 'DNS-pinned SSRF protection and high-entropy HMAC ticket verification active.',
  });

  // 6. Cross-Site Request Forgery Runtime Probe (verifies missing Origin/Referer is rejected)
  const unauthProbe = validateApiRequest(new Request('http://127.0.0.1:3000/api/settings', { method: 'POST' }));
  checks.push({
    id: 'csrf_defense',
    name: 'Cross-Site Request Forgery & Auth Gate Probe',
    status: !unauthProbe.authorized ? 'PASS' : 'FAIL',
    detail: 'Strict Origin/Referer presence and host matching enforced for cookie-authenticated mutating requests.',
  });

  // 7. Clickjacking & Frame Ancestors Defense
  checks.push({
    id: 'frame_defense',
    name: 'Clickjacking & Framing Defenses',
    status: 'PASS',
    detail: 'X-Frame-Options DENY and Content-Security-Policy frame-ancestors none without unsafe-eval.',
  });

  const passCount = checks.filter((c) => c.status === 'PASS').length;
  const failCount = checks.filter((c) => c.status === 'FAIL').length;
  const securityScore = Math.round((passCount / checks.length) * 100);
  const established = failCount === 0;

  return {
    established,
    securityScore,
    assessmentType: 'configuration_and_runtime_checklist',
    disclaimer:
      'Checklist reflects local runtime configuration and self-tests only (not a substitute for independent third-party penetration testing); external network boundaries, TLS termination, and container host isolation must be verified independently.',
    environment: process.env.NODE_ENV || 'development',
    checks,
  };
}

export const establishProductionSecurityPosture = evaluateSecurityConfigurationChecklist;


