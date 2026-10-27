import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const ENCRYPTED_SECRETS_FILE = path.join(STORAGE_DIR, 'secrets.enc');
const LEGACY_SECRETS_FILE = path.join(STORAGE_DIR, 'secrets.json');
const AUTH_SECRET_FILE = path.join(STORAGE_DIR, 'auth_secret');
const SALT_FILE = path.join(STORAGE_DIR, 'encryption.salt');
const MASTER_KEY_FILE = path.join(STORAGE_DIR, 'master.key');

export interface StoredSecrets {
  geminiApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
}

export const SUPPORTED_MODELS = {
  gemini: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  ollama: ['llama3.2', 'mistral', 'deepseek-r1', 'qwen2.5-coder'],
};

/**
 * Gets or initializes a cryptographically random 16-byte salt persisted with 0600 permissions.
 * Prevents rainbow table and dictionary attacks even on password-only installations.
 */
function getOrInitSalt(): Buffer {
  try {
    if (fsSync.existsSync(SALT_FILE)) {
      const existing = fsSync.readFileSync(SALT_FILE);
      if (existing.length >= 16) {
        return existing;
      }
    }
    if (!fsSync.existsSync(STORAGE_DIR)) {
      fsSync.mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
    }
    const newSalt = crypto.randomBytes(16);
    fsSync.writeFileSync(SALT_FILE, newSalt, { mode: 0o600 });
    return newSalt;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cryptographic failure: Unable to initialize or access secure persistent salt at ${SALT_FILE}. Refusing insecure constant salt fallback. Details: ${message}`);
  }
}

/**
 * Derives a strong 256-bit encryption key using PBKDF2 from configured owner credentials.
 * Strictly eliminates predictable fallback secrets and supports password-only installations.
 */
function getDerivedKey(): Buffer {
  let masterSecret = (
    process.env.NOOK_SECRET_KEY ||
    process.env.NOOK_API_KEY ||
    process.env.NOOK_PASSWORD ||
    process.env.NOOK_SECRET_TOKEN ||
    ''
  ).trim();

  if (!masterSecret) {
    try {
      if (fsSync.existsSync(AUTH_SECRET_FILE)) {
        masterSecret = fsSync.readFileSync(AUTH_SECRET_FILE, 'utf8').trim();
      }
    } catch {}
  }

  if (!masterSecret) {
    try {
      if (fsSync.existsSync(MASTER_KEY_FILE)) {
        masterSecret = fsSync.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
      } else {
        if (!fsSync.existsSync(STORAGE_DIR)) {
          fsSync.mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
        }
        const generated = crypto.randomBytes(32).toString('hex');
        fsSync.writeFileSync(MASTER_KEY_FILE, generated, { encoding: 'utf8', mode: 0o600 });
        masterSecret = generated;
      }
    } catch {
      throw new Error('Cryptographic setup incomplete: No master encryption credential configured. Set NOOK_PASSWORD or NOOK_SECRET_KEY in server environment.');
    }
  }

  const salt = getOrInitSalt();
  // Derive cryptographically strong 256-bit key via 100,000 rounds of PBKDF2-HMAC-SHA256
  return crypto.pbkdf2Sync(masterSecret, salt, 100000, 32, 'sha256');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 */
function encrypt(text: string): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

/**
 * Decrypts ciphertext using AES-256-GCM.
 */
function decrypt(payloadStr: string): string {
  const key = getDerivedKey();
  const payload = JSON.parse(payloadStr);
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const encrypted = Buffer.from(payload.data, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Loads and decrypts stored provider credentials.
 * Automatically migrates legacy plaintext secrets.json to encrypted secrets.enc.
 */
export async function loadEncryptedSecrets(): Promise<StoredSecrets> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  // 1. Try reading encrypted file
  try {
    const rawEnc = await fs.readFile(ENCRYPTED_SECRETS_FILE, 'utf8');
    const decryptedJson = decrypt(rawEnc);
    return JSON.parse(decryptedJson);
  } catch {
    // fall through to legacy check
  }

  // 2. Migration from legacy plaintext secrets.json if present
  try {
    const rawLegacy = await fs.readFile(LEGACY_SECRETS_FILE, 'utf8');
    const secrets: StoredSecrets = JSON.parse(rawLegacy);
    // Write out encrypted immediately
    await saveEncryptedSecrets(secrets);
    // Remove plaintext legacy file
    await fs.unlink(LEGACY_SECRETS_FILE).catch(() => {});
    return secrets;
  } catch {
    return {};
  }
}

/**
 * Encrypts and atomically writes credentials to disk.
 */
export async function saveEncryptedSecrets(secrets: StoredSecrets): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const ciphertext = encrypt(JSON.stringify(secrets));
  const tempFile = `${ENCRYPTED_SECRETS_FILE}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, ciphertext, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempFile, ENCRYPTED_SECRETS_FILE);

  // Clean up legacy plaintext file if still around
  await fs.unlink(LEGACY_SECRETS_FILE).catch(() => {});
}

/**
 * Safely masks a secret string for UI status displays (e.g. sk-proj-...1234).
 */
export function maskSecret(secret?: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '••••••••';
  const prefix = secret.slice(0, 4);
  const suffix = secret.slice(-4);
  return `${prefix}••••${suffix}`;
}
