import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { safeFetch, validateOutboundUrl } from '@/lib/ssrf';

export async function POST(req: NextRequest) {
  // 1. Authorization check
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error, auth.status);
  }

  try {
    const { url, agentId } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Valid URL is required' }, { status: 400 });
    }

    const targetUrl = url.startsWith('http://') || url.startsWith('https://') 
      ? url 
      : `https://${url}`;

    // 2. Pre-flight SSRF check
    const validation = await validateOutboundUrl(targetUrl);
    if (!validation.allowed) {
      return NextResponse.json({
        error: `SSRF Policy Violation: ${validation.reason}`,
        url: targetUrl,
        agentId: agentId || 'unknown',
        status: 403,
      }, { status: 403 });
    }

    // 3. Execute safe outbound fetch through centralized SSRF engine
    let fetchResult;
    try {
      fetchResult = await safeFetch(targetUrl, {
        maxRedirects: 3,
        maxBytes: 2 * 1024 * 1024,
        timeoutMs: 8000,
      });
    } catch (fetchErr: any) {
      const isSsrfBlock = fetchErr.message?.includes('SSRF Protection');
      return NextResponse.json({
        error: `Browser fetch failed: ${fetchErr.message}`,
        url: targetUrl,
        agentId: agentId || 'unknown',
        status: isSsrfBlock ? 403 : 502,
      }, { status: isSsrfBlock ? 403 : 502 });
    }

    const { status, statusText, text: html, finalUrl } = fetchResult;

    // 4. Extract authentic page title and structured preview
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : new URL(finalUrl).hostname;

    // Extract visible textual preview
    const cleanBody = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500);

    return NextResponse.json({
      url: finalUrl,
      pageTitle,
      status,
      statusText,
      agentId: agentId || 'scout',
      contentLength: html.length,
      snippet: cleanBody,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal browser error' }, { status: 500 });
  }
}
