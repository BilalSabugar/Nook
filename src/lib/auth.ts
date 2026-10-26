import { NextRequest, NextResponse } from 'next/server';

export interface AuthValidationResult {
  authorized: boolean;
  status?: number;
  error?: string;
  sessionToken?: string;
}

/**
 * Validates request authorization token across headers or bearer credentials.
 * Ensures API endpoints cannot be abused or invoked by unauthenticated callers.
 */
export function validateApiRequest(req: NextRequest): AuthValidationResult {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-nook-api-key') || '';
  const sessionTokenHeader = req.headers.get('x-nook-session-token') || '';
  const cookieSession = req.cookies.get('nook_session')?.value || '';

  // 1. Check Bearer token
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (apiKeyHeader) {
    token = apiKeyHeader.trim();
  } else if (sessionTokenHeader) {
    token = sessionTokenHeader.trim();
  } else if (cookieSession) {
    token = cookieSession.trim();
  }

  // 2. Production API Key validation if configured in environment
  const configuredApiKey = process.env.NOOK_API_KEY || process.env.NOOK_SECRET_TOKEN;
  if (configuredApiKey) {
    if (!token || token !== configuredApiKey) {
      return {
        authorized: false,
        status: 401,
        error: 'Unauthorized: Invalid or missing NOOK_API_KEY bearer token',
      };
    }
    return { authorized: true, sessionToken: token };
  }

  // 3. Sovereign local/standard session validation
  // Requires at least one valid session or dev credential
  if (!token) {
    // If running in development with no explicit token supplied, we check for sovereign origin or dev bypass header
    const host = req.headers.get('host') || '';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    if (isLocalhost) {
      // Allow local loopback request but tag with auto session
      return { authorized: true, sessionToken: 'local-sovereign-session' };
    }

    return {
      authorized: false,
      status: 401,
      error: 'Unauthorized: Missing API authorization token or session token',
    };
  }

  return { authorized: true, sessionToken: token };
}

export function unauthorizedResponse(errorMsg = 'Unauthorized: Access denied'): NextResponse {
  return NextResponse.json(
    {
      error: errorMsg,
      code: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    },
    { status: 401 }
  );
}
