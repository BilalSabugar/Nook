import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import zlib from 'zlib';
import { safeFetch, validateOutboundUrl } from './ssrf.ts';
import { logAuditEvent } from './db.ts';

export interface InteractiveElement {
  id: string;
  type: 'link' | 'button' | 'input';
  text: string;
  selector: string;
  href?: string;
}

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
  interactiveElements: InteractiveElement[];
  screenshotPath?: string;
  screenshotMetadata?: {
    isSyntheticPlaceholder: boolean;
    captureType: 'synthetic_placeholder' | 'chromium_headless';
    capturedAt: string;
    notice: string;
  };
  consoleLogs: string[];
  lastAction: string;
  updatedAt: string;
}

const STORAGE_ROOT = path.join(process.cwd(), '.nook_storage');
const SESSIONS_DIR = path.join(STORAGE_ROOT, 'browser_sessions');
const SCREENSHOTS_DIR = path.join(STORAGE_ROOT, 'browser_screenshots');

// In-memory cache for low-latency queries backed by durable disk storage
const activeBrowserSessions = new Map<string, ObservableBrowserSession>();

/**
 * Ensures durable storage directories exist with secure permissions.
 */
function ensureStorageDirectories(): void {
  try {
    if (!fsSync.existsSync(SESSIONS_DIR)) {
      fsSync.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
    }
    if (!fsSync.existsSync(SCREENSHOTS_DIR)) {
      fsSync.mkdirSync(SCREENSHOTS_DIR, { recursive: true, mode: 0o700 });
    }
  } catch {
    // ignore
  }
}

/**
 * Renders an authentic binary PNG image representing the browser viewport.
 * Generates valid PNG IHDR, IDAT (zlib compressed scanlines), and IEND chunks.
 */
export function renderBrowserScreenshotPng(
  _title: string = 'Nook Sandboxed Browser',
  _url: string = 'about:blank',
  status: number = 200,
  width: number = 640,
  height: number = 480
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA color type
  ihdrData[10] = 0; // Deflate compression
  ihdrData[11] = 0; // Standard filter
  ihdrData[12] = 0; // Non-interlaced

  const ihdrTypeAndData = Buffer.concat([Buffer.from('IHDR'), ihdrData]);
  const ihdrCrc = Buffer.alloc(4);
  ihdrCrc.writeUInt32BE(zlib.crc32(ihdrTypeAndData), 0);
  const ihdrChunk = Buffer.concat([Buffer.alloc(4), ihdrTypeAndData, ihdrCrc]);
  ihdrChunk.writeUInt32BE(13, 0);

  // Generate rendered scanlines (browser chrome + page background)
  const bytesPerPixel = 4;
  const scanlineLength = 1 + width * bytesPerPixel;
  const rawScanlines = Buffer.alloc(scanlineLength * height);

  const isError = status >= 400;
  // Browser chrome colors
  const chromeR = 15, chromeG = 23, chromeB = 42; // Slate 900
  // Viewport background colors
  const bgR = isError ? 40 : 24, bgG = isError ? 15 : 24, bgB = isError ? 15 : 27;

  for (let y = 0; y < height; y++) {
    const offset = y * scanlineLength;
    rawScanlines[offset] = 0; // Filter: None
    const isHeaderBar = y < 36;
    const isUrlBar = y >= 8 && y <= 28;

    for (let x = 0; x < width; x++) {
      const pOffset = offset + 1 + x * bytesPerPixel;
      if (isHeaderBar) {
        if (isUrlBar && x > 80 && x < width - 40) {
          rawScanlines[pOffset] = 30;
          rawScanlines[pOffset + 1] = 41;
          rawScanlines[pOffset + 2] = 59;
          rawScanlines[pOffset + 3] = 255;
        } else {
          rawScanlines[pOffset] = chromeR;
          rawScanlines[pOffset + 1] = chromeG;
          rawScanlines[pOffset + 2] = chromeB;
          rawScanlines[pOffset + 3] = 255;
        }
      } else {
        rawScanlines[pOffset] = bgR;
        rawScanlines[pOffset + 1] = bgG;
        rawScanlines[pOffset + 2] = bgB;
        rawScanlines[pOffset + 3] = 255;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawScanlines);
  const idatTypeAndData = Buffer.concat([Buffer.from('IDAT'), compressedData]);
  const idatCrc = Buffer.alloc(4);
  idatCrc.writeUInt32BE(zlib.crc32(idatTypeAndData), 0);
  const idatChunk = Buffer.concat([Buffer.alloc(4), idatTypeAndData, idatCrc]);
  idatChunk.writeUInt32BE(compressedData.length, 0);

  // IEND chunk
  const iendChunk = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Persists an observable browser session state to durable disk storage.
 */
async function persistSessionToDisk(session: ObservableBrowserSession): Promise<void> {
  try {
    ensureStorageDirectories();
    const sessionFile = path.join(SESSIONS_DIR, `${session.agentId}.json`);
    const tempFile = `${sessionFile}.${Date.now()}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempFile, sessionFile);
  } catch {
    // Disk write fallback
  }
}

/**
 * Loads a persisted browser session from disk if available.
 */
function loadSessionFromDisk(safeAgentId: string): ObservableBrowserSession | null {
  try {
    ensureStorageDirectories();
    const sessionFile = path.join(SESSIONS_DIR, `${safeAgentId}.json`);
    if (fsSync.existsSync(sessionFile)) {
      const data = fsSync.readFileSync(sessionFile, 'utf8');
      return JSON.parse(data);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Gets or initializes a persistent observable browser session for an agent coworker.
 * Recovers persisted sessions from disk so state survives process restarts.
 */
export function getOrCreateBrowserSession(agentId: string): ObservableBrowserSession {
  const safeId = (agentId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  
  // 1. Check in-memory cache
  const existing = activeBrowserSessions.get(safeId);
  if (existing) return existing;

  // 2. Recover from persistent disk storage
  const fromDisk = loadSessionFromDisk(safeId);
  if (fromDisk) {
    activeBrowserSessions.set(safeId, fromDisk);
    return fromDisk;
  }

  // 3. Initialize fresh durable session
  const initialSession: ObservableBrowserSession = {
    agentId: safeId,
    sessionId: `browser-${safeId}-${Date.now()}`,
    currentUrl: 'about:blank',
    history: ['about:blank'],
    historyIndex: 0,
    title: 'Nook Sandboxed Browser',
    status: 200,
    statusText: 'OK',
    domPreview: '<h1>Welcome to Nook Coworker Browser</h1><p>Isolated network environment active with SSRF egress enforcement and persistent state.</p>',
    headings: ['Welcome to Nook Coworker Browser'],
    links: [],
    interactiveElements: [],
    screenshotMetadata: {
      isSyntheticPlaceholder: true,
      captureType: 'synthetic_placeholder',
      capturedAt: new Date().toISOString(),
      notice: 'Synthetic viewport preview. Headless Chromium capture not provisioned in this environment.',
    },
    consoleLogs: ['[Supervisor] Sandboxed durable browser session initialized'],
    lastAction: 'initialized',
    updatedAt: new Date().toISOString(),
  };

  activeBrowserSessions.set(safeId, initialSession);
  try {
    ensureStorageDirectories();
    const sessionFile = path.join(SESSIONS_DIR, `${safeId}.json`);
    fsSync.writeFileSync(sessionFile, JSON.stringify(initialSession, null, 2), { mode: 0o600 });
  } catch {}
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
    await persistSessionToDisk(session);
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

  // Extract verified outbound links and interactive elements
  const links: Array<{ text: string; href: string }> = [];
  const interactiveElements: InteractiveElement[] = [];
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let lMatch: RegExpExecArray | null;
  let elementIdx = 1;

  while ((lMatch = linkRegex.exec(html)) !== null && links.length < 15) {
    const href = lMatch[1].trim();
    const linkText = lMatch[2].replace(/<[^>]+>/g, '').trim();
    if (linkText && (href.startsWith('http') || href.startsWith('/'))) {
      try {
        const resolvedHref = new URL(href, response.finalUrl).toString();
        links.push({ text: linkText.slice(0, 50), href: resolvedHref });
        interactiveElements.push({
          id: `elem-${elementIdx++}`,
          type: 'link',
          text: linkText.slice(0, 50),
          selector: `a[href="${href}"]`,
          href: resolvedHref,
        });
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

  // Render and persist authentic PNG screenshot to disk
  const screenshotFileName = `${session.agentId}-snap-${Date.now()}.png`;
  try {
    ensureStorageDirectories();
    const pngBuffer = renderBrowserScreenshotPng(title, response.finalUrl, response.status);
    fsSync.writeFileSync(path.join(SCREENSHOTS_DIR, screenshotFileName), pngBuffer, { mode: 0o600 });
  } catch {
    // Disk write error fallback
  }

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
  session.interactiveElements = interactiveElements;
  session.screenshotPath = `/api/sandbox/browse/screenshot?file=${screenshotFileName}`;
  session.screenshotMetadata = {
    isSyntheticPlaceholder: true,
    captureType: 'synthetic_placeholder',
    capturedAt: new Date().toISOString(),
    notice: 'Synthetic viewport preview. Headless Chromium capture not provisioned in this environment.',
  };
  session.lastAction = `navigate(${response.finalUrl})`;
  session.updatedAt = new Date().toISOString();
  session.consoleLogs.push(`[Navigation Complete] Rendered "${title}" (Status ${response.status})`);

  logAuditEvent('BROWSER_NAVIGATE', `Navigated to ${response.finalUrl} (${title})`, 'success', agentId);
  await persistSessionToDisk(session);
  return session;
}

/**
 * Interactively clicks an indexed element on the current page.
 */
export async function clickInteractiveElement(
  agentId: string,
  elementIdOrSelector: string
): Promise<{ success: boolean; session: ObservableBrowserSession; error?: string }> {
  const session = getOrCreateBrowserSession(agentId);
  const element = session.interactiveElements.find(
    (e) => e.id === elementIdOrSelector || e.selector === elementIdOrSelector
  );

  if (!element) {
    session.consoleLogs.push(`[Interactive Error] Element "${elementIdOrSelector}" not found on page.`);
    await persistSessionToDisk(session);
    return {
      success: false,
      session,
      error: `Interactive browser error: Element "${elementIdOrSelector}" not found in active session DOM.`,
    };
  }

  session.consoleLogs.push(`[Interactive Action] Clicked element "${element.text}" (${element.selector})`);
  session.lastAction = `click(${element.id})`;

  if (element.type === 'link' && element.href) {
    const updated = await navigateBrowser(agentId, element.href);
    return { success: true, session: updated };
  }

  session.updatedAt = new Date().toISOString();
  await persistSessionToDisk(session);
  return { success: true, session };
}

/**
 * Captures screenshot metadata and ensures a rendered PNG screenshot exists on disk.
 */
export function captureSessionScreenshot(agentId: string): string {
  const session = getOrCreateBrowserSession(agentId);
  ensureStorageDirectories();
  const screenshotFileName = `${session.agentId}-snap-${Date.now()}.png`;
  const filePath = path.join(SCREENSHOTS_DIR, screenshotFileName);
  try {
    const pngBuffer = renderBrowserScreenshotPng(session.title, session.currentUrl, session.status);
    fsSync.writeFileSync(filePath, pngBuffer, { mode: 0o600 });
  } catch {
    // ignore write error
  }
  session.screenshotPath = `/api/sandbox/browse/screenshot?file=${screenshotFileName}`;
  session.screenshotMetadata = {
    isSyntheticPlaceholder: true,
    captureType: 'synthetic_placeholder',
    capturedAt: new Date().toISOString(),
    notice: 'Synthetic viewport preview. Headless Chromium capture not provisioned in this environment.',
  };
  return session.screenshotPath;
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
      await persistSessionToDisk(session);
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
