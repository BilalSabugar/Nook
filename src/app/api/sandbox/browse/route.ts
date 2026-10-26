import { NextRequest, NextResponse } from 'next/server';
import dns from 'dns/promises';
import net from 'net';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';

/**
 * Checks whether an IP address belongs to private, loopback, link-local,
 * cloud metadata, or other non-routable address spaces.
 */
function isPrivateOrDisallowedIp(ip: string): boolean {
  // Normalize IPv6 mapped IPv4 e.g. ::ffff:127.0.0.1
  let cleanIp = ip;
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7);
  }

  // IPv4 Checks
  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(Number);
    const [b0, b1] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (Private RFC 1918)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (Private RFC 1918: 172.16 - 172.31)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Private RFC 1918)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-local & Cloud instance metadata AWS/GCP/Azure: 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (b0 >= 224) return true;

    return false;
  }

  // IPv6 Checks
  if (net.isIPv6(cleanIp)) {
    const lower = cleanIp.toLowerCase();
    // Loopback
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // Unique local address (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local address (fe80::/10)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

    return false;
  }

  return true;
}

/**
 * Resolves all DNS records for target hostname and validates IP safety before network connection.
 */
async function validateUrlDns(targetUrl: string): Promise<{ safe: boolean; error?: string }> {
  try {
    const parsed = new URL(targetUrl);

    // Only permit standard HTTP / HTTPS
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, error: `Protocol ${parsed.protocol} is disallowed by Nook security policy.` };
    }

    const host = parsed.hostname;

    // Direct check for string literal hostnames
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return { safe: false, error: 'Access to local hostnames is prohibited.' };
    }

    // Resolve all IPv4 and IPv6 addresses associated with the hostname
    const records = await dns.lookup(host, { all: true });
    if (!records || records.length === 0) {
      return { safe: false, error: `Could not resolve hostname ${host}.` };
    }

    for (const record of records) {
      if (isPrivateOrDisallowedIp(record.address)) {
        return {
          safe: false,
          error: `Security violation: ${host} resolves to private/internal IP address (${record.address}). Connection rejected.`,
        };
      }
    }

    return { safe: true };
  } catch (err: any) {
    return { safe: false, error: `DNS resolution failed: ${err.message}` };
  }
}

export async function POST(req: NextRequest) {
  // 1. Authorization check
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Valid URL is required' }, { status: 400 });
    }

    let currentUrl = url.startsWith('http://') || url.startsWith('https://') 
      ? url 
      : `https://${url}`;

    // 2. Validate initial URL DNS & IP
    const initialCheck = await validateUrlDns(currentUrl);
    if (!initialCheck.safe) {
      return NextResponse.json({
        error: initialCheck.error,
        url: currentUrl,
        status: 403,
      }, { status: 403 });
    }

    // 3. Fetch with manual redirect following & per-redirect DNS validation
    let response: Response | null = null;
    let redirectCount = 0;
    const maxRedirects = 3;

    while (redirectCount <= maxRedirects) {
      response = await fetch(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 NookBot/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });

      // Handle HTTP redirects (301, 302, 307, 308)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;

        const resolvedRedirectUrl = new URL(location, currentUrl).toString();
        // Verify DNS of the redirect target to prevent SSRF via redirect chaining
        const redirectCheck = await validateUrlDns(resolvedRedirectUrl);
        if (!redirectCheck.safe) {
          return NextResponse.json({
            error: `Redirect blocked: ${redirectCheck.error}`,
            url: resolvedRedirectUrl,
            status: 403,
          }, { status: 403 });
        }

        currentUrl = resolvedRedirectUrl;
        redirectCount++;
        continue;
      }

      break;
    }

    if (!response) {
      return NextResponse.json({
        error: 'Failed to establish connection to target URL.',
        status: 502,
      }, { status: 502 });
    }

    // 4. Handle non-2xx responses honestly
    if (!response.ok) {
      return NextResponse.json({
        error: `Remote server responded with HTTP ${response.status} (${response.statusText})`,
        url: currentUrl,
        status: response.status,
      }, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
      return NextResponse.json({
        url: currentUrl,
        status: response.status,
        statusText: response.statusText,
        title: `Binary Content (${contentType})`,
        headings: [],
        links: [],
        textContent: `[Binary content of type ${contentType}]`,
        timestamp: new Date().toISOString(),
      });
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : currentUrl;

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const metaDescription = descMatch ? descMatch[1].trim() : '';

    // Extract headings (h1, h2, h3)
    const headingMatches = [...html.matchAll(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi)];
    const headings = headingMatches.slice(0, 8).map(m => {
      const cleanText = m[2].replace(/<[^>]+>/g, '').trim();
      return { tag: m[1].toLowerCase(), text: cleanText };
    }).filter(h => h.text.length > 0);

    // Extract top links
    const linkMatches = [...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const links = linkMatches.slice(0, 10).map(m => {
      let href = m[1];
      if (href.startsWith('/')) {
        try {
          const parsed = new URL(currentUrl);
          href = `${parsed.origin}${href}`;
        } catch {}
      }
      return {
        href,
        text: m[2].replace(/<[^>]+>/g, '').trim(),
      };
    }).filter(l => l.text.length > 0 && (l.href.startsWith('http://') || l.href.startsWith('https://')));

    // Extract cleaned readable text content
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);

    return NextResponse.json({
      url: currentUrl,
      status: response.status,
      statusText: response.statusText,
      title,
      metaDescription,
      headings,
      links,
      textContent: cleanText,
      extractedBytes: html.length,
      timestamp: new Date().toISOString(),
    });
  } catch (fetchErr: any) {
    // Return honest HTTP error status instead of fake simulated 200 snapshot
    const isTimeout = fetchErr.name === 'TimeoutError' || fetchErr.message?.includes('timeout');
    const statusCode = isTimeout ? 504 : 502;
    return NextResponse.json({
      error: `Failed to fetch web resource: ${fetchErr.message || 'Network unreachable'}`,
      status: statusCode,
      timestamp: new Date().toISOString(),
    }, { status: statusCode });
  }
}
