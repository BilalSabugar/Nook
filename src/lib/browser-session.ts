import { safeFetch, validateOutboundUrl } from './ssrf.ts';
import { logAuditEvent } from './db.ts';

export interface ObservableBrowserSession {
  agentId: string;
  sessionId: string;
  currentUrl: string;
  history: string[];
  historyIndex: number;
  title: string;
  status: number;
  statusText: string;
  domPreview: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  consoleLogs: string[];
  lastAction: string;
  updatedAt: string;
}

// In-memory persistent browser sessions keyed by agentId
const activeBrowserSessions = new Map<string, ObservableBrowserSession>();

/**
 * Gets or initializes an observable browser session for an agent coworker.
 */
export function getOrCreateBrowserSession(agentId: string): ObservableBrowserSession {
  const safeId = (agentId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const existing = activeBrowserSessions.get(safeId);
  if (existing) return existing;

  const initialSession: ObservableBrowserSession = {
    agentId: safeId,
    sessionId: `browser-${safeId}-${Date.now()}`,
    currentUrl: 'about:blank',
    history: ['about:blank'],
    historyIndex: 0,
    title: 'Nook Sandboxed Browser',
    status: 200,
    statusText: 'OK',
    domPreview: '<h1>Welcome to Nook Coworker Browser</h1><p>Isolated network environment active with SSRF egress enforcement.</p>',
    headings: ['Welcome to Nook Coworker Browser'],
    links: [],
    consoleLogs: ['[Supervisor] Sandboxed browser session initialized'],
    lastAction: 'initialized',
    updatedAt: new Date().toISOString(),
  };

  activeBrowserSessions.set(safeId, initialSession);
  return initialSession;
}

/**
 * Navigates an agent's persistent browser session to an authorized URL.
 * Strictly enforces network-level egress restrictions via validateOutboundUrl & safeFetch.
 */
export async function navigateBrowser(
  agentId: string,
  rawUrl: string
): Promise<ObservableBrowserSession> {
  const session = getOrCreateBrowserSession(agentId);
  const targetUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
    ? rawUrl
    : `https://${rawUrl}`;

  // 1. Strict pre-flight SSRF check
  const validation = await validateOutboundUrl(targetUrl);
  if (!validation.allowed) {
    session.consoleLogs.push(`[Security Error] Blocked navigation to ${targetUrl}: ${validation.reason}`);
    logAuditEvent('BROWSER_EGRESS_BLOCKED', `SSRF blocked navigation to ${targetUrl}: ${validation.reason}`, 'blocked', agentId);
    throw new Error(`SSRF Policy Violation: Outbound browser navigation blocked. ${validation.reason}`);
  }

  session.consoleLogs.push(`[Navigation] Requesting ${targetUrl} (Pinned IP: ${validation.resolvedIps?.[0] || 'validated'})`);

  // 2. Fetch page through DNS-pinned safeFetch engine
  const response = await safeFetch(targetUrl, {
    maxRedirects: 4,
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 9000,
  });

  const html = response.bodyText;

  // 3. Extract DOM metadata
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(response.finalUrl).hostname;

  // Extract headings
  const headings: string[] = [];
  const headingRegex = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 8) {
    const text = hMatch[1].replace(/<[^>]+>/g, '').trim();
    if (text) headings.push(text);
  }

  // Extract verified outbound links
  const links: Array<{ text: string; href: string }> = [];
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = linkRegex.exec(html)) !== null && links.length < 12) {
    const href = lMatch[1].trim();
    const linkText = lMatch[2].replace(/<[^>]+>/g, '').trim();
    if (linkText && (href.startsWith('http') || href.startsWith('/'))) {
      try {
        const resolvedHref = new URL(href, response.finalUrl).toString();
        links.push({ text: linkText.slice(0, 50), href: resolvedHref });
      } catch {
        // ignore invalid link
      }
    }
  }

  // Clean visible text preview
  const cleanSnippet = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  // Update session state
  session.currentUrl = response.finalUrl;
  if (session.history[session.historyIndex] !== response.finalUrl) {
    session.history = session.history.slice(0, session.historyIndex + 1);
    session.history.push(response.finalUrl);
    session.historyIndex = session.history.length - 1;
  }
  session.title = title;
  session.status = response.status;
  session.statusText = response.statusText;
  session.domPreview = cleanSnippet;
  session.headings = headings;
  session.links = links;
  session.lastAction = `navigate(${response.finalUrl})`;
  session.updatedAt = new Date().toISOString();
  session.consoleLogs.push(`[Navigation Complete] Rendered "${title}" (Status ${response.status})`);

  logAuditEvent('BROWSER_NAVIGATE', `Navigated to ${response.finalUrl} (${title})`, 'success', agentId);
  return session;
}

/**
 * Navigates backward in browser history.
 */
export async function navigateBack(agentId: string): Promise<ObservableBrowserSession> {
  const session = getOrCreateBrowserSession(agentId);
  if (session.historyIndex > 0) {
    session.historyIndex--;
    const prevUrl = session.history[session.historyIndex];
    if (prevUrl === 'about:blank') {
      session.currentUrl = 'about:blank';
      session.title = 'Blank Page';
      session.domPreview = '';
      session.lastAction = 'history_back';
      return session;
    }
    return navigateBrowser(agentId, prevUrl);
  }
  return session;
}

/**
 * Navigates forward in browser history.
 */
export async function navigateForward(agentId: string): Promise<ObservableBrowserSession> {
  const session = getOrCreateBrowserSession(agentId);
  if (session.historyIndex < session.history.length - 1) {
    session.historyIndex++;
    const nextUrl = session.history[session.historyIndex];
    return navigateBrowser(agentId, nextUrl);
  }
  return session;
}
