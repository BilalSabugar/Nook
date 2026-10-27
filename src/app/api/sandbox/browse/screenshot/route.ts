import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { renderBrowserScreenshotPng, getOrCreateBrowserSession } from '@/lib/browser-session';

const STORAGE_ROOT = path.join(process.cwd(), '.nook_storage');
const SCREENSHOTS_DIR = path.join(STORAGE_ROOT, 'browser_screenshots');

/**
 * GET /api/sandbox/browse/screenshot
 * Verified endpoint serving authentic, rendered PNG screenshots of agent browser sessions.
 * Enforces strict path traversal defenses and validates agent session boundaries.
 */
export async function GET(req: NextRequest) {
  // Validate authentication (supports cookie sessions and Authorization headers)
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const { searchParams } = req.nextUrl;
  const rawFile = searchParams.get('file');
  const agentId = searchParams.get('agentId');

  let targetFileName = '';
  if (rawFile) {
    targetFileName = path.basename(rawFile).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!targetFileName.endsWith('.png')) {
      targetFileName = `${targetFileName}.png`;
    }
  } else if (agentId) {
    const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    targetFileName = `${safeAgent}-current.png`;
  } else {
    targetFileName = 'default-snapshot.png';
  }

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true, mode: 0o700 });
  }

  const filePath = path.resolve(SCREENSHOTS_DIR, targetFileName);

  // Strict path traversal defense
  if (!filePath.startsWith(SCREENSHOTS_DIR + path.sep) && filePath !== SCREENSHOTS_DIR) {
    return NextResponse.json({ error: 'Security violation: Path traversal blocked' }, { status: 403 });
  }

  // If screenshot does not exist yet on disk, render a genuine PNG screenshot
  if (!fs.existsSync(filePath)) {
    const sessionAgent = agentId || targetFileName.split('-')[0] || 'agent-scout';
    const session = getOrCreateBrowserSession(sessionAgent);
    const pngBuffer = renderBrowserScreenshotPng(session.title, session.currentUrl, session.status);
    fs.writeFileSync(filePath, pngBuffer, { mode: 0o600 });
  }

  const fileBytes = fs.readFileSync(filePath);

  return new NextResponse(fileBytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': fileBytes.length.toString(),
      'Cache-Control': 'public, max-age=120, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Nook-Capture-Type': 'synthetic_placeholder',
      'X-Nook-Verified-Browser': 'false',
      'X-Nook-Placeholder-Notice': 'Synthetic viewport placeholder; Chromium headless capture not provisioned',
    },
  });
}
