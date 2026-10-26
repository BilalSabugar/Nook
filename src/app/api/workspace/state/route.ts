import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const STATE_FILE = path.join(STORAGE_DIR, 'workspace-state.json');

/**
 * GET /api/workspace/state
 * Retrieves durable workspace state from the server filesystem.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    await fs.access(STATE_FILE);
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return NextResponse.json({
      hasDurableState: true,
      data,
    });
  } catch {
    return NextResponse.json({
      hasDurableState: false,
      message: 'No durable server state recorded yet. Client will seed initial state.',
    });
  }
}

/**
 * POST /api/workspace/state
 * Durably saves agent states, living spaces, and computer environments to disk.
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const payload = await req.json();
    const { agents, spaces, computerStates, messages, settings } = payload;

    await fs.mkdir(STORAGE_DIR, { recursive: true });

    // 1. Atomic write for workspace state JSON
    const tempFile = `${STATE_FILE}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(
      {
        agents,
        spaces,
        computerStates,
        messages,
        settings,
        savedAt: new Date().toISOString(),
      },
      null,
      2
    );

    await fs.writeFile(tempFile, serialized, 'utf8');
    await fs.rename(tempFile, STATE_FILE);

    // 2. Persist per-agent workspace files onto durable server disk
    if (computerStates && typeof computerStates === 'object') {
      for (const [agentId, compState] of Object.entries<any>(computerStates)) {
        if (compState?.files && Array.isArray(compState.files)) {
          const agentDiskDir = path.join(STORAGE_DIR, 'sandboxes', agentId, 'workspace');
          await fs.mkdir(agentDiskDir, { recursive: true });

          for (const file of compState.files) {
            if (file?.name && typeof file?.content === 'string') {
              const safeName = path.basename(file.name);
              await fs.writeFile(path.join(agentDiskDir, safeName), file.content, 'utf8');
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      savedAt: new Date().toISOString(),
      storageDirectory: STORAGE_DIR,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
