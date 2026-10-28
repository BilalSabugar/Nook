import http from 'http';
import net from 'net';
import dns from 'dns';
import { isForbiddenIpv4, isForbiddenIpv6 } from './ssrf.ts';
import { logAuditEvent } from './db.ts';

export interface EgressProxyInstance {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

let _globalProxy: EgressProxyInstance | null = null;
let _startingPromise: Promise<EgressProxyInstance> | null = null;

export async function resolveHostSafely(hostname: string): Promise<{ safe: boolean; reason?: string; pinnedIp?: string; allIps?: string[] }> {
  // Respect test loopback override if configured (strictly disabled in production)
  if (process.env.ALLOW_TEST_LOOPBACK === 'true' && process.env.NODE_ENV !== 'production') {
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return { safe: true, pinnedIp: '127.0.0.1', allIps: ['127.0.0.1'] };
    }
  }

  // Check direct IP
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isForbiddenIpv4(hostname)) {
      return { safe: false, reason: `Direct IP ${hostname} is in forbidden private/link-local/metadata range` };
    }
    if (net.isIPv6(hostname) && isForbiddenIpv6(hostname)) {
      return { safe: false, reason: `Direct IPv6 ${hostname} is in forbidden private/link-local range` };
    }
    return { safe: true, pinnedIp: hostname, allIps: [hostname] };
  }

  // Obvious internal domain names
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.local') ||
    lower === 'metadata.google.internal' ||
    lower === 'instance-data'
  ) {
    return { safe: false, reason: `Forbidden internal host: ${hostname}` };
  }

  try {
    const lookupResults = await dns.promises.lookup(hostname, { all: true });
    if (!lookupResults || lookupResults.length === 0) {
      return { safe: false, reason: `No DNS records found for ${hostname}` };
    }

    const allIps: string[] = [];
    for (const r of lookupResults) {
      allIps.push(r.address);
      if (r.family === 4 && isForbiddenIpv4(r.address)) {
        return { safe: false, reason: `Resolved IP ${r.address} is forbidden (private/metadata)`, allIps };
      }
      if (r.family === 6 && isForbiddenIpv6(r.address)) {
        return { safe: false, reason: `Resolved IPv6 ${r.address} is forbidden (private/local)`, allIps };
      }
    }

    return { safe: true, pinnedIp: lookupResults[0].address, allIps };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { safe: false, reason: `DNS resolution failed for ${hostname}: ${msg}` };
  }
}

export function createEgressProxy(): Promise<EgressProxyInstance> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Plain HTTP proxying
      try {
        const rawUrl = req.url || '';
        const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `http://${req.headers.host || 'unknown'}${rawUrl}`);
        const check = await resolveHostSafely(parsed.hostname);

        if (!check.safe || !check.pinnedIp) {
          logAuditEvent('BROWSER_EGRESS_BLOCKED', `Egress HTTP proxy blocked request to ${parsed.href}: ${check.reason}`, 'blocked');
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end(`403 Forbidden by Nook Browser Egress Policy: ${check.reason || 'Restricted host'}`);
          return;
        }

        const isHttps = parsed.protocol === 'https:';
        const port = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80);

        const proxyReq = http.request({
          host: check.pinnedIp,
          port,
          path: parsed.pathname + parsed.search,
          method: req.method,
          headers: {
            ...req.headers,
            host: parsed.host,
          },
          timeout: 15000,
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`502 Bad Gateway: ${err.message}`);
          }
        });

        req.pipe(proxyReq);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Proxy Error');
        }
      }
    });

    // CONNECT tunnel proxying (for HTTPS)
    server.on('connect', async (req, clientSocket, head) => {
      try {
        const [host, portStr] = (req.url || '').split(':');
        const port = parseInt(portStr, 10) || 443;
        const check = await resolveHostSafely(host);

        if (!check.safe || !check.pinnedIp) {
          logAuditEvent('BROWSER_EGRESS_BLOCKED', `Egress CONNECT tunnel blocked for ${host}:${port}: ${check.reason}`, 'blocked');
          clientSocket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nForbidden by Nook Egress Policy\r\n');
          clientSocket.destroy();
          return;
        }

        const targetSocket = net.connect({ host: check.pinnedIp, port }, () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Nook-Egress-Guard\r\n\r\n');
          if (head && head.length > 0) {
            targetSocket.write(head);
          }
          targetSocket.pipe(clientSocket);
          clientSocket.pipe(targetSocket);
        });

        targetSocket.on('error', () => {
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          clientSocket.destroy();
        });

        clientSocket.on('error', () => {
          targetSocket.destroy();
        });
      } catch {
        clientSocket.write('HTTP/1.1 500 Internal Proxy Error\r\n\r\n');
        clientSocket.destroy();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      if (typeof server.unref === 'function') {
        server.unref();
      }
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind egress proxy address'));
        return;
      }
      const port = addr.port;
      const url = `http://127.0.0.1:${port}`;
      const instance: EgressProxyInstance = {
        server,
        port,
        url,
        close: () =>
          new Promise((res) => {
            server.close(() => res());
          }),
      };
      resolve(instance);
    });

    server.on('error', reject);
  });
}

export async function getGlobalEgressProxy(): Promise<EgressProxyInstance> {
  if (_globalProxy) return _globalProxy;
  if (!_startingPromise) {
    _startingPromise = createEgressProxy().then((proxy) => {
      _globalProxy = proxy;
      _startingPromise = null;
      return proxy;
    });
  }
  return _startingPromise;
}

export async function stopGlobalEgressProxy(): Promise<void> {
  if (_globalProxy) {
    const p = _globalProxy;
    _globalProxy = null;
    await p.close();
  }
}
