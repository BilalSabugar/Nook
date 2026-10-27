import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import {
  getOrCreateBrowserSession,
  navigateBrowser,
  navigateBack,
  navigateForward,
} from '@/lib/browser-session';

/**
 * GET /api/sandbox/browse?agentId=...
 * Inspects active observable browser session state.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error, auth.status);
  }

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') || 'agent-scout';
  const session = getOrCreateBrowserSession(agentId);

  return NextResponse.json({
    success: true,
    session,
  });
}

/**
 * POST /api/sandbox/browse
 * Performs browser navigation, history traversal, or interaction with SSRF egress enforcement.
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error, auth.status);
  }

  try {
    const body = await req.json();
    const { url, agentId, action } = body;
    const safeAgentId = agentId || 'agent-scout';

    if (action === 'back') {
      const session = await navigateBack(safeAgentId);
      return NextResponse.json({
        success: true,
        session,
        url: session.currentUrl,
        pageTitle: session.title,
        status: session.status,
        statusText: session.statusText,
        snippet: session.domPreview,
        timestamp: session.updatedAt,
      });
    }

    if (action === 'forward') {
      const session = await navigateForward(safeAgentId);
      return NextResponse.json({
        success: true,
        session,
        url: session.currentUrl,
        pageTitle: session.title,
        status: session.status,
        statusText: session.statusText,
        snippet: session.domPreview,
        timestamp: session.updatedAt,
      });
    }

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Valid URL is required' }, { status: 400 });
    }

    const session = await navigateBrowser(safeAgentId, url);

    return NextResponse.json({
      success: true,
      session,
      url: session.currentUrl,
      pageTitle: session.title,
      status: session.status,
      statusText: session.statusText,
      agentId: safeAgentId,
      contentLength: session.domPreview.length,
      snippet: session.domPreview,
      headings: session.headings,
      links: session.links,
      timestamp: session.updatedAt,
    });
  } catch (error: any) {
    const isSsrfBlock = error.message?.includes('SSRF Policy Violation');
    return NextResponse.json({
      error: error.message || 'Browser navigation error',
      status: isSsrfBlock ? 403 : 502,
    }, { status: isSsrfBlock ? 403 : 502 });
  }
}
