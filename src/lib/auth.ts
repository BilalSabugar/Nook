import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const SECRET_FILE = path.join(STORAGE_DIR, 'auth_secret');

export interface AuthValidationResult {
  authorized: boolean;
  status?: number;
  error?: string;
  sessionId?: string;
  authMethod?: 'api_key' | 'session_token' | 'session_cookie';
}

/**
 * Retrieves the cryptographic server master secret derived from configured owner credentials.
 * Strictly FAILS CLOSED: Never uses process.pid fallbacks or unconfigured auto-generation.
 */
function getMasterSecret(): string {
  const configured = (
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();

  if (configured && configured.length >= 8) {
    return crypto.createHmac('sha256', configured).update('nook-owner-session-secret-v1').digest('hex');
  }

  try {
    if (fs.existsSync(SECRET_FILE)) {
      const secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (secret.length >= 32) {
        return secret;
      }
    }
  } catch {
    // ignore
  }

  throw new Error('Authentication setup incomplete: No master owner secret configured. Set NOOK_API_KEY or NOOK_PASSWORD in server environment.');
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

  const secret = getMasterSecret();
  const expiresAt = Date.now() + ttlMs;
  const payload = `${sessionId}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
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

  const secret = getMasterSecret();
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

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  record.count += 1;
  return true;
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
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
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
  if ((req as any).cookies?.get) {
    cookieSession = (req as any).cookies.get('nook_session')?.value || '';
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

  // 4. Verify against static NOOK_API_KEY if configured
  const configuredKey = (process.env.NOOK_API_KEY || process.env.NOOK_SECRET_TOKEN || '').trim();
  if (configuredKey && candidateToken === configuredKey) {
    return { authorized: true, sessionId: 'api-key-owner', authMethod: 'api_key' };
  }

  // 5. Verify cryptographic signed session token
  const verification = verifySessionToken(candidateToken);
  if (verification.valid) {
    // CSRF protection: for cookie-authenticated mutating requests, verify Origin / Referer
    if (authMethod === 'session_cookie' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.headers.get('origin') || '';
      const referer = req.headers.get('referer') || '';
      const host = req.headers.get('host') || '';

      if (origin) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
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
          const refererHost = new URL(referer).host;
          if (refererHost !== host) {
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
 * Checks whether owner authentication credentials have been configured in server environment.
 */
export function isServerAuthSetupComplete(): boolean {
  const configured = (
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();

  return Boolean(configured && configured.length >= 8);
}

/**
 * Verifies owner credentials against configured server secrets.
 * Fails closed if NOOK_API_KEY, NOOK_PASSWORD, or NOOK_SECRET_TOKEN is not configured.
 * Uses constant-time comparison to prevent timing side-channel attacks.
 */
export function verifyOwnerCredentials(candidate: string): boolean {
  const configured = (
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();

  // Fail closed if unconfigured or insecurely short (< 8 chars)
  if (!configured || configured.length < 8) {
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

