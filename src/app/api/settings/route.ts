import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const SECRETS_FILE = path.join(STORAGE_DIR, 'secrets.json');
const SETTINGS_FILE = path.join(STORAGE_DIR, 'settings.json');

// Allowed Ollama endpoints to prevent SSRF to arbitrary cloud endpoints
const ALLOWED_OLLAMA_PREFIXES = [
  'http://localhost:',
  'http://127.0.0.1:',
  'http://[::1]:',
];

interface StoredSecrets {
  geminiApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

interface StoredSettings {
  provider: 'simulation' | 'gemini' | 'openai' | 'anthropic' | 'ollama';
  model: string;
  temperature: number;
  ollamaEndpoint: string;
}

export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    let secrets: StoredSecrets = {};
    try {
      const rawSecrets = await fs.readFile(SECRETS_FILE, 'utf8');
      secrets = JSON.parse(rawSecrets);
    } catch {
      // no custom stored secrets
    }

    let settings: StoredSettings = {
      provider: 'simulation',
      model: 'gemini-1.5-flash',
      temperature: 0.7,
      ollamaEndpoint: 'http://localhost:11434',
    };
    try {
      const rawSettings = await fs.readFile(SETTINGS_FILE, 'utf8');
      settings = { ...settings, ...JSON.parse(rawSettings) };
    } catch {
      // defaults
    }

    // Never return raw secret keys to client! Return status indicators only.
    return NextResponse.json({
      provider: settings.provider,
      model: settings.model,
      temperature: settings.temperature,
      ollamaEndpoint: settings.ollamaEndpoint,
      configuredProviders: {
        gemini: Boolean(process.env.GEMINI_API_KEY || secrets.geminiApiKey),
        openai: Boolean(process.env.OPENAI_API_KEY || secrets.openaiApiKey),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY || secrets.anthropicApiKey),
        ollama: Boolean(process.env.OLLAMA_BASE_URL || settings.ollamaEndpoint),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { provider, model, temperature, ollamaEndpoint, geminiApiKey, openaiApiKey, anthropicApiKey } = body;

    // Validate provider
    const validProviders = ['simulation', 'gemini', 'openai', 'anthropic', 'ollama'];
    if (provider && !validProviders.includes(provider)) {
      return NextResponse.json({ error: `Invalid provider: ${provider}` }, { status: 400 });
    }

    // Validate Ollama endpoint to block arbitrary remote targets
    if (ollamaEndpoint) {
      const isAllowed = ALLOWED_OLLAMA_PREFIXES.some(prefix => ollamaEndpoint.startsWith(prefix));
      if (!isAllowed) {
        return NextResponse.json({
          error: 'Restricted: Ollama endpoint must be an approved local service (e.g. http://localhost:11434). Arbitrary remote endpoints are prohibited for security.',
        }, { status: 400 });
      }
    }

    await fs.mkdir(STORAGE_DIR, { recursive: true });

    // 1. Update server settings
    const settingsUpdate: StoredSettings = {
      provider: provider || 'simulation',
      model: model || 'gemini-1.5-flash',
      temperature: typeof temperature === 'number' ? Math.max(0, Math.min(1, temperature)) : 0.7,
      ollamaEndpoint: ollamaEndpoint || 'http://localhost:11434',
    };
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settingsUpdate, null, 2), 'utf8');

    // 2. Update server secrets if explicitly provided (stored on server disk, never sent to browser)
    let currentSecrets: StoredSecrets = {};
    try {
      const rawSecrets = await fs.readFile(SECRETS_FILE, 'utf8');
      currentSecrets = JSON.parse(rawSecrets);
    } catch {}

    if (geminiApiKey !== undefined && geminiApiKey.trim()) currentSecrets.geminiApiKey = geminiApiKey.trim();
    if (openaiApiKey !== undefined && openaiApiKey.trim()) currentSecrets.openaiApiKey = openaiApiKey.trim();
    if (anthropicApiKey !== undefined && anthropicApiKey.trim()) currentSecrets.anthropicApiKey = anthropicApiKey.trim();

    await fs.writeFile(SECRETS_FILE, JSON.stringify(currentSecrets, null, 2), 'utf8');

    return NextResponse.json({
      success: true,
      message: 'Settings and credentials saved securely on server.',
      configuredProviders: {
        gemini: Boolean(process.env.GEMINI_API_KEY || currentSecrets.geminiApiKey),
        openai: Boolean(process.env.OPENAI_API_KEY || currentSecrets.openaiApiKey),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY || currentSecrets.anthropicApiKey),
        ollama: Boolean(process.env.OLLAMA_BASE_URL || settingsUpdate.ollamaEndpoint),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
