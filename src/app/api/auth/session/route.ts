import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionToken,
  verifySessionToken,
  verifyOwnerCredentials,
  isServerAuthSetupComplete,
  checkLoginRateLimit,
  recordFailedLogin,
  recordSuccessfulLogin,
  resolveClientIp,
  verifyApproverCredentials,
  APPROVER_SESSION_ID,
} from '@/lib/auth';

/**
 * GET /api/auth/session
 * Validates active session cookie or bearer token.
 * Strictly FAILS CLOSED: Does NOT auto-issue owner sessions to unauthenticated visitors.
 */
export async function GET(req: NextRequest) {
  const cookieSession = req.cookies.get('nook_session')?.value || '';
  const authHeader = req.headers.get('authorization')?.slice(7).trim() || '';
  const token = cookieSession || authHeader;
  const isSetup = isServerAuthSetupComplete();

  if (token) {
    const verified = verifySessionToken(token);
    if (verified.valid) {
      return NextResponse.json({
        authenticated: true,
        sessionId: verified.sessionId,
        mode: 'single-user-owner',
        setupConfigured: isSetup,
      });
    }
  }

  // Strictly fail closed: anonymous visitors receive 401 Unauthorized
  return NextResponse.json(
    {
      authenticated: false,
      error: 'Authentication required. No valid active session.',
      setupConfigured: isSetup,
    },
    { status: 401 }
  );
}

/**
 * POST /api/auth/session
 * Authenticates the owner with password or API key, then issues a secure HttpOnly cookie.
 * 1. Fails closed when setup is incomplete (no key/password configured on server).
 * 2. Requires genuine owner credential verification before session issuance.
 * 3. Does NOT return session tokens in the JSON response body when secure cookies are established.
 */
export async function POST(req: NextRequest) {
  try {
    const isSetup = isServerAuthSetupComplete();
    if (!isSetup) {
      return NextResponse.json(
        {
          error: 'Server authentication setup incomplete: NOOK_API_KEY or NOOK_PASSWORD must be configured in the server environment.',
          code: 'SETUP_INCOMPLETE',
        },
        { status: 503 }
      );
    }

    const ip = resolveClientIp(req.headers);
    const rateLimit = checkLoginRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please wait ${rateLimit.retryAfterSeconds} seconds before trying again.`,
          code: 'RATE_LIMITED',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSeconds || 60),
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const credential = String(body.apiKey || body.password || body.credential || '').trim();

    if (!credential) {
      return NextResponse.json(
        {
          error: 'Authentication required: Password or API key must be supplied.',
          code: 'CREDENTIAL_REQUIRED',
        },
        { status: 400 }
      );
    }

    // Approver credential (distinct from every machine credential) yields the human-approver identity.
    const isApprover = verifyApproverCredentials(credential);
    const isAuthorized = isApprover || verifyOwnerCredentials(credential);
    if (!isAuthorized) {
      recordFailedLogin(ip);
      return NextResponse.json(
        {
          error: 'Unauthorized: Invalid owner credentials.',
          code: 'INVALID_CREDENTIALS',
        },
        { status: 401 }
      );
    }

    recordSuccessfulLogin(ip);

    const sessionId = isApprover ? APPROVER_SESSION_ID : 'nook-owner';
    const sessionToken = createSessionToken(sessionId);
    const response = NextResponse.json({
      success: true,
      authenticated: true,
      sessionId,
      canApprove: isApprover,
      message: 'Session authenticated successfully. Secure session cookie established.',
    });

    // Establish secure HttpOnly cookie without exposing token in response JSON body
    response.cookies.set('nook_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message || 'Authentication error' }, { status: 500 });
  }
}

/**
 * DELETE /api/auth/session
 * Logs out and clears the session cookie.
 */
export async function DELETE() {
  const response = NextResponse.json({
    success: true,
    authenticated: false,
    message: 'Session terminated and cookie cleared.',
  });

  response.cookies.set('nook_session', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return response;
}
