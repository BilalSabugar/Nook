import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { loadEncryptedSecrets, saveEncryptedSecrets, maskSecret, StoredSecrets } from '@/lib/secrets';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const SETTINGS_FILE = path.join(STORAGE_DIR, 'settings.json');

// Allowed Ollama endpoints to prevent SSRF to arbitrary cloud endpoints
const ALLOWED_OLLAMA_PREFIXES = [
  'http://localhost:',
  'http://127.0.0.1:',
  'http://[::1]:',
];

export const SUPPORTED_MODELS: Record<string, string[]> = {
  gemini: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'gpt-4-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  ollama: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'qwen2.5-coder'],
  simulation: ['simulation-v1'],
};

interface StoredSettings {
  provider: 'simulation' | 'gemini' | 'openai' | 'anthropic' | 'ollama';
  model: string;
  temperature: number;
  ollamaEndpoint: string;
}

export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error, auth.status);
  }

  try {
    const secrets = await loadEncryptedSecrets();

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

    const geminiKey = process.env.GEMINI_API_KEY || secrets.geminiApiKey;
    const openaiKey = process.env.OPENAI_API_KEY || secrets.openaiApiKey;
    const anthropicKey = process.env.ANTHROPIC_API_KEY || secrets.anthropicApiKey;
    const ollamaUrl = process.env.OLLAMA_BASE_URL || settings.ollamaEndpoint;

    // Never return raw secret keys to client! Return status indicators and masked previews only.
    return NextResponse.json({
      provider: settings.provider,
      model: settings.model,
      temperature: settings.temperature,
      ollamaEndpoint: settings.ollamaEndpoint,
      supportedModels: SUPPORTED_MODELS,
      configuredProviders: {
        gemini: Boolean(geminiKey),
        openai: Boolean(openaiKey),
        anthropic: Boolean(anthropicKey),
        ollama: Boolean(ollamaUrl),
      },
      previews: {
        gemini: maskSecret(geminiKey),
        openai: maskSecret(openaiKey),
        anthropic: maskSecret(anthropicKey),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error, auth.status);
  }

  try {
    const body = await req.json();
    const { action, provider, model, temperature, ollamaEndpoint, geminiApiKey, openaiApiKey, anthropicApiKey } = body;

    const secrets = await loadEncryptedSecrets();

    // Provider Connection Testing
    if (action === 'test_connection') {
      const targetProvider = provider || 'simulation';

      if (targetProvider === 'simulation') {
        return NextResponse.json({ success: true, message: 'Autonomous zero-key simulation operational.' });
      }

      if (targetProvider === 'gemini') {
        const key = geminiApiKey || process.env.GEMINI_API_KEY || secrets.geminiApiKey;
        if (!key) return NextResponse.json({ error: 'No Gemini API key configured.' }, { status: 400 });

        const testRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
          method: 'GET',
          signal: AbortSignal.timeout(6000),
        });
        if (!testRes.ok) {
          const errData = await testRes.json().catch(() => ({}));
          return NextResponse.json({
            error: `Gemini API connection failed (HTTP ${testRes.status}): ${errData?.error?.message || testRes.statusText}`,
          }, { status: 502 });
        }
        return NextResponse.json({ success: true, message: 'Google Gemini API connection verified successfully.' });
      }

      if (targetProvider === 'openai') {
        const key = openaiApiKey || process.env.OPENAI_API_KEY || secrets.openaiApiKey;
        if (!key) return NextResponse.json({ error: 'No OpenAI API key configured.' }, { status: 400 });

        // Security Guard: Prevent Gemini keys from flowing to OpenAI
        if (key.startsWith('AIza')) {
          return NextResponse.json({
            error: 'Credential routing error: Gemini API key provided for OpenAI provider. Cross-provider secret flow is blocked.',
          }, { status: 400 });
        }

        const testRes = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(6000),
        });
        if (!testRes.ok) {
          const errData = await testRes.json().catch(() => ({}));
          return NextResponse.json({
            error: `OpenAI API connection failed (HTTP ${testRes.status}): ${errData?.error?.message || testRes.statusText}`,
          }, { status: 502 });
        }
        return NextResponse.json({ success: true, message: 'OpenAI API connection verified successfully.' });
      }

      if (targetProvider === 'anthropic') {
        const key = anthropicApiKey || process.env.ANTHROPIC_API_KEY || secrets.anthropicApiKey;
        if (!key) return NextResponse.json({ error: 'No Anthropic API key configured.' }, { status: 400 });

        const testRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(6000),
        });
        // 400/200 indicates credential validity (auth succeeded)
        if (testRes.status === 401 || testRes.status === 403) {
          return NextResponse.json({ error: 'Anthropic API connection failed: Invalid API Key.' }, { status: 502 });
        }
        return NextResponse.json({ success: true, message: 'Anthropic Claude API connection verified successfully.' });
      }

      if (targetProvider === 'ollama') {
        const url = ollamaEndpoint || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        try {
          const testRes = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
          if (!testRes.ok) {
            return NextResponse.json({ error: `Ollama returned HTTP ${testRes.status}` }, { status: 502 });
          }
          const tags = await testRes.json();
          const availableModels = (tags.models || []).map((m: any) => m.name);
          return NextResponse.json({
            success: true,
            message: `Ollama local instance reachable. Detected ${availableModels.length} models.`,
            models: availableModels,
          });
        } catch (err: any) {
          return NextResponse.json({
            error: `Cannot connect to local Ollama at ${url}: ${err.message}. Ensure Ollama is running ('ollama serve').`,
          }, { status: 502 });
        }
      }
    }

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
          error: 'Restricted: Ollama endpoint must be an approved local service (e.g. http://localhost:11434). Arbitrary remote endpoints are prohibited.',
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

    // 2. Update server encrypted secrets if provided
    const updatedSecrets: StoredSecrets = { ...secrets };
    if (geminiApiKey !== undefined && geminiApiKey.trim()) updatedSecrets.geminiApiKey = geminiApiKey.trim();
    if (openaiApiKey !== undefined && openaiApiKey.trim()) updatedSecrets.openaiApiKey = openaiApiKey.trim();
    if (anthropicApiKey !== undefined && anthropicApiKey.trim()) updatedSecrets.anthropicApiKey = anthropicApiKey.trim();

    await saveEncryptedSecrets(updatedSecrets);

    return NextResponse.json({
      success: true,
      message: 'Configuration and encrypted credentials saved securely on server.',
      configuredProviders: {
        gemini: Boolean(process.env.GEMINI_API_KEY || updatedSecrets.geminiApiKey),
        openai: Boolean(process.env.OPENAI_API_KEY || updatedSecrets.openaiApiKey),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY || updatedSecrets.anthropicApiKey),
        ollama: Boolean(process.env.OLLAMA_BASE_URL || settingsUpdate.ollamaEndpoint),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
