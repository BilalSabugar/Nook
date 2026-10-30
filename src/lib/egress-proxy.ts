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
  const cleanHost = (hostname || '').replace(/^\[|\]$/g, '').trim().toLowerCase();
  if (!cleanHost) {
    return { safe: false, reason: 'Empty hostname' };
  }

  // Respect test loopback override if configured (strictly disabled in production)
  if (process.env.ALLOW_TEST_LOOPBACK === 'true' && process.env.NODE_ENV !== 'production') {
    if (cleanHost === '127.0.0.1' || cleanHost === 'localhost') {
      return { safe: true, pinnedIp: '127.0.0.1', allIps: ['127.0.0.1'] };
    }
  }

  // Check direct IP
  if (net.isIP(cleanHost)) {
    if (net.isIPv4(cleanHost) && isForbiddenIpv4(cleanHost)) {
      return { safe: false, reason: `Direct IP ${cleanHost} is in forbidden private/link-local/metadata range` };
    }
    if (net.isIPv6(cleanHost) && isForbiddenIpv6(cleanHost)) {
      return { safe: false, reason: `Direct IPv6 ${cleanHost} is in forbidden private/link-local range` };
    }
    return { safe: true, pinnedIp: cleanHost, allIps: [cleanHost] };
  }

  // Obvious internal domain names
  if (
    cleanHost === 'localhost' ||
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.internal') ||
    cleanHost.endsWith('.local') ||
    cleanHost === 'metadata.google.internal' ||
    cleanHost === 'instance-data'
  ) {
    return { safe: false, reason: `Forbidden internal host: ${cleanHost}` };
  }

  try {
    const lookupResults = await dns.promises.lookup(cleanHost, { all: true });
    if (!lookupResults || lookupResults.length === 0) {
      return { safe: false, reason: `No DNS records found for ${cleanHost}` };
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
    return { safe: false, reason: `DNS resolution failed for ${cleanHost}: ${msg}` };
  }
}

const FORBIDDEN_PORTS = new Set([
  20, 21,    // FTP
  22,        // SSH
  23,        // Telnet
  25, 465, 587, // SMTP
  53,        // DNS
  67, 68,    // DHCP
  69,        // TFTP
  110, 995,  // POP3
  137, 138, 139, 445, // SMB / NetBIOS
  143, 993,  // IMAP
  389, 636,  // LDAP
  1433,      // MSSQL
  1521,      // Oracle
  2375, 2376,// Docker daemon
  3306,      // MySQL
  5432,      // PostgreSQL
  6379,      // Redis
  11211,     // Memcached
  27017,     // MongoDB
]);

export function isForbiddenPort(port: number): boolean {
  if (isNaN(port) || port < 1 || port > 65535) return true;
  return FORBIDDEN_PORTS.has(port);
}

export function createEgressProxy(): Promise<EgressProxyInstance> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Plain HTTP proxying
      try {
        const rawUrl = req.url || '';
        let parsed: URL;
        try {
          parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `http://${req.headers.host || 'unknown'}${rawUrl}`);
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('400 Bad Request: Malformed egress URL');
          return;
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end(`403 Forbidden by Nook Browser Egress Policy: Unsupported protocol '${parsed.protocol}'`);
          return;
        }

        const isHttps = parsed.protocol === 'https:';
        const port = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80);

        if (isForbiddenPort(port)) {
          logAuditEvent('BROWSER_EGRESS_BLOCKED', `Egress HTTP proxy blocked request to unsafe port ${parsed.href}`, 'blocked');
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end(`403 Forbidden by Nook Browser Egress Policy: Outbound port ${port} is restricted`);
          return;
        }

        const check = await resolveHostSafely(parsed.hostname);

        if (!check.safe || !check.pinnedIp) {
          logAuditEvent('BROWSER_EGRESS_BLOCKED', `Egress HTTP proxy blocked request to ${parsed.href}: ${check.reason}`, 'blocked');
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end(`403 Forbidden by Nook Browser Egress Policy: ${check.reason || 'Restricted host'}`);
          return;
        }

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
        const rawUrl = req.url || '';
        let host = rawUrl;
        let port = 443;
        if (rawUrl.startsWith('[')) {
          const closing = rawUrl.indexOf(']');
          if (closing !== -1) {
            host = rawUrl.slice(1, closing);
            const rest = rawUrl.slice(closing + 1);
            if (rest.startsWith(':')) {
              port = parseInt(rest.slice(1), 10) || 443;
            }
          }
        } else if (rawUrl.includes(':')) {
          const lastColon = rawUrl.lastIndexOf(':');
          host = rawUrl.slice(0, lastColon);
          port = parseInt(rawUrl.slice(lastColon + 1), 10) || 443;
        }

        if (isForbiddenPort(port)) {
          logAuditEvent('BROWSER_EGRESS_BLOCKED', `Egress CONNECT tunnel blocked for unsafe port ${host}:${port}`, 'blocked');
          clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nForbidden by Nook Egress Policy: Restricted Port\r\n');
          return;
        }

        const check = await resolveHostSafely(host);

        if (!check.safe || !check.pinnedIp) {
          logAuditEvent('BROWSER_EGRESS_BLOCKED', `Egress CONNECT tunnel blocked for ${host}:${port}: ${check.reason}`, 'blocked');
          clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nForbidden by Nook Egress Policy\r\n');
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
          if (!clientSocket.destroyed) {
            clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
          }
        });

        clientSocket.on('error', () => {
          targetSocket.destroy();
        });
      } catch {
        if (!clientSocket.destroyed) {
          clientSocket.end('HTTP/1.1 500 Internal Proxy Error\r\nConnection: close\r\n\r\n');
        }
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
  if (_globalProxy && _globalProxy.server && _globalProxy.server.listening) {
    return _globalProxy;
  }
  if (_globalProxy) {
    _globalProxy = null;
  }
  if (!_startingPromise) {
    _startingPromise = createEgressProxy()
      .then((proxy) => {
        _globalProxy = proxy;
        _startingPromise = null;
        return proxy;
      })
      .catch((err) => {
        _globalProxy = null;
        _startingPromise = null;
        throw err;
      });
  }
  return _startingPromise;
}

export async function stopGlobalEgressProxy(): Promise<void> {
  if (_globalProxy) {
    const p = _globalProxy;
    _globalProxy = null;
    _startingPromise = null;
    await p.close();
  }
}
