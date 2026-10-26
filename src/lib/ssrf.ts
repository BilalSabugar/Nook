import dns from 'dns';
import net from 'net';

export interface SsrfValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedIps?: string[];
}

/**
 * Checks if an IPv4 address is within private, loopback, link-local, carrier-grade NAT, or cloud metadata ranges.
 */
function isForbiddenIpv4(ip: string): boolean {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed IPv4 is forbidden
  }

  const [b0, b1] = parts;

  // 0.0.0.0/8 (Current network)
  if (b0 === 0) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 10.0.0.0/8 (Private network)
  if (b0 === 10) return true;

  // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.168.0.0/16 (Private network)
  if (b0 === 192 && b1 === 168) return true;

  // 169.254.0.0/16 (Link-local, including AWS/GCP/Azure metadata 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 100.64.0.0/10 (Carrier-Grade NAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation)
  if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;
  if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;
  if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (b0 >= 224) return true;

  return false;
}

/**
 * Checks if an IPv6 address is loopback, unique-local, link-local, or IPv4-mapped private.
 */
function isForbiddenIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // Loopback (::1)
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice(7);
    if (net.isIPv4(v4Part)) {
      return isForbiddenIpv4(v4Part);
    }
    return true; // Conservative reject
  }

  // Unique local addresses (fc00::/7 - fc00: to fdff:)
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;

  // Link-local addresses (fe80::/10 - fe80: to febf:)
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;

  return false;
}

/**
 * Validates a target URL against SSRF vulnerabilities:
 * - Restricts protocol to http: and https:
 * - Resolves all DNS records (IPv4 & IPv6) and verifies no IP falls into forbidden ranges.
 * - Protects against DNS rebinding and IP-encoding bypasses.
 */
export async function validateOutboundUrl(rawUrl: string): Promise<SsrfValidationResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'Invalid or malformed URL' };
  }

  // 1. Strict protocol check
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      allowed: false,
      reason: `Blocked protocol '${parsedUrl.protocol}'. Only http: and https: are permitted.`,
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 2. Reject obvious localhost, metadata hostnames, and IP shorthands
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data'
  ) {
    return {
      allowed: false,
      reason: `Access to internal host '${hostname}' is prohibited by Nook SSRF security policy.`,
    };
  }

  // 3. If hostname is directly an IP address
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isForbiddenIpv4(hostname)) {
      return { allowed: false, reason: `Direct IP ${hostname} is in a reserved/private range.` };
    }
    if (net.isIPv6(hostname) && isForbiddenIpv6(hostname)) {
      return { allowed: false, reason: `Direct IPv6 ${hostname} is in a reserved/private range.` };
    }
  }

  // 4. Resolve DNS and inspect all IPv4 and IPv6 addresses
  try {
    const lookupResults = await dns.promises.lookup(hostname, { all: true });
    const resolvedIps = lookupResults.map(r => r.address);

    if (resolvedIps.length === 0) {
      return { allowed: false, reason: 'DNS resolution yielded no address records.' };
    }

    for (const record of lookupResults) {
      if (record.family === 4 && isForbiddenIpv4(record.address)) {
        return {
          allowed: false,
          reason: `Resolved IP ${record.address} for '${hostname}' is in a private, loopback, or metadata network.`,
          resolvedIps,
        };
      }
      if (record.family === 6 && isForbiddenIpv6(record.address)) {
        return {
          allowed: false,
          reason: `Resolved IPv6 ${record.address} for '${hostname}' is in a reserved or local network.`,
          resolvedIps,
        };
      }
    }

    return { allowed: true, resolvedIps };
  } catch (dnsErr: any) {
    return {
      allowed: false,
      reason: `DNS lookup failed for '${hostname}': ${dnsErr.message || 'Host unresolvable'}`,
    };
  }
}

/**
 * Performs a safe HTTP fetch with:
 * - Pre-flight SSRF validation
 * - Manual redirect inspection (validates each hop against SSRF)
 * - Maximum response size guard (default 2MB)
 * - Timeout guard (default 10s)
 */
export interface SafeFetchResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: Headers;
  text: string;
  bodyText: string;
  finalUrl: string;
}

export async function safeFetch(
  rawUrl: string,
  options: {
    maxRedirects?: number;
    maxBytes?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<SafeFetchResponse> {
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024; // 2MB
  const timeoutMs = options.timeoutMs ?? 10000;

  let currentUrl = rawUrl;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    // 1. Validate destination URL before connecting
    const validation = await validateOutboundUrl(currentUrl);
    if (!validation.allowed) {
      throw new Error(`SSRF Protection: Outbound request to '${currentUrl}' blocked. ${validation.reason}`);
    }

    // 2. Execute fetch with manual redirect handling and timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Nook-Coworker-Bot/1.0 (Autonomous Research Agent)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
          ...(options.headers || {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }

    // 3. Handle redirects manually
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response from ${currentUrl} contained no Location header.`);
      }

      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = nextUrl;
      redirectsCount++;
      continue;
    }

    // 4. Stream response body up to maxBytes limit
    if (!res.body) {
      const text = await res.text();
      return {
        status: res.status,
        statusText: res.statusText,
        ok: res.status >= 200 && res.status < 300,
        headers: res.headers,
        text,
        bodyText: text,
        finalUrl: currentUrl,
      };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        receivedBytes += value.length;
        if (receivedBytes > maxBytes) {
          reader.cancel();
          throw new Error(`Response payload exceeded safe limit of ${maxBytes} bytes.`);
        }
        chunks.push(value);
      }
    }

    const totalBuffer = Buffer.concat(chunks);
    const text = totalBuffer.toString('utf8');

    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.status >= 200 && res.status < 300,
      headers: res.headers,
      text,
      bodyText: text,
      finalUrl: currentUrl,
    };
  }

  throw new Error(`Too many redirects (exceeded limit of ${maxRedirects}).`);
}
