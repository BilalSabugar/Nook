import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, createSessionToken, verifySessionToken } from '@/lib/auth';

/**
 * GET /api/auth/session
 * Validates active session or issues single-user owner session cookie for the web UI.
 */
export async function GET(req: NextRequest) {
  const cookieSession = req.cookies.get('nook_session')?.value || '';
  const authHeader = req.headers.get('authorization')?.slice(7).trim() || '';
  const token = cookieSession || authHeader;

  if (token) {
    const verified = verifySessionToken(token);
    if (verified.valid) {
      return NextResponse.json({
        authenticated: true,
        sessionId: verified.sessionId,
        mode: 'single-user-owner',
      });
    }
  }

  // Issue single-user session for direct first-party browser access
  const newSessionToken = createSessionToken('nook-owner');
  const response = NextResponse.json({
    authenticated: true,
    sessionId: 'nook-owner',
    mode: 'single-user-owner',
    sessionToken: newSessionToken,
  });

  response.cookies.set('nook_session', newSessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });

  return response;
}

/**
 * POST /api/auth/session
 * Explicit authentication with master API key or session generation.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { apiKey } = body;

    const configuredKey = (process.env.NOOK_API_KEY || process.env.NOOK_SECRET_TOKEN || '').trim();

    if (configuredKey && apiKey !== configuredKey) {
      return NextResponse.json({ error: 'Invalid NOOK_API_KEY credentials.' }, { status: 401 });
    }

    const sessionToken = createSessionToken('nook-owner');
    const response = NextResponse.json({
      success: true,
      sessionId: 'nook-owner',
      sessionToken,
    });

    response.cookies.set('nook_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/auth/session
 * Logs out and clears the session cookie.
 */
export async function DELETE() {
  const response = NextResponse.json({ success: true, message: 'Logged out' });
  response.cookies.delete('nook_session');
  return response;
}
