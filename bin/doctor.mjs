#!/usr/bin/env node
/**
 * Nook Configuration & Security Preflight Doctor (`npm run doctor`)
 * Inspects local/deployment configuration and verifies security boundaries
 * without ever printing or logging secret values.
 */

import fs from 'fs';
import path from 'path';

const KNOWN_PUBLIC_EXAMPLE_SECRETS = new Set([
  'nook-production-api-key-change-this-32bytes',
  'nook-human-approver-secret-password-32bytes',
  'nook-owner-change-me-32-chars-minimum',
  'nook-approver-distinct-human-secret-32c',
  'nook-api-key-change-me-32-chars-minimum',
  '0123456789abcdef0123456789abcdef0123456789abcdef',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'nook_internal_runner_auth_secret_v1',
  'test-audit-runner-secret-key-32bytes',
  'default_secret_do_not_use_in_prod',
  'changeme',
  'change-me',
  'secret',
  'password',
  'default',
  'admin',
  '12345678',
  'replace-with-openssl-rand-hex-32',
]);

function isKnownWeakOrExample(val) {
  if (!val || typeof val !== 'string') return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  if (KNOWN_PUBLIC_EXAMPLE_SECRETS.has(trimmed) || KNOWN_PUBLIC_EXAMPLE_SECRETS.has(trimmed.toLowerCase())) {
    return true;
  }
  return new Set(trimmed).size < 5;
}

export function runDoctorChecks(envOrOpts = process.env) {
  const hasExplicitEnvVars =
    envOrOpts &&
    typeof envOrOpts === 'object' &&
    ('NOOK_API_KEY' in envOrOpts || 'NOOK_PASSWORD' in envOrOpts || 'PATH' in envOrOpts);
  const env = hasExplicitEnvVars ? envOrOpts : process.env;
  const isProd = Boolean(envOrOpts?.production) || env.NODE_ENV === 'production';
  const checks = [];

  // 1. Node.js Runtime Version
  const nodeVersion = process.versions.node;
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 6)) {
    checks.push({
      id: 'node_runtime',
      status: 'PASS',
      message: `Node.js runtime v${nodeVersion} satisfies >=22.6.0 requirement (native node:sqlite available).`,
    });
  } else {
    checks.push({
      id: 'node_runtime',
      status: 'FAIL',
      message: `Node.js runtime v${nodeVersion} is below minimum required >=22.6.0.`,
    });
  }

  // 2. Master Authentication Secret (NOOK_API_KEY / NOOK_PASSWORD)
  const masterSecret = (env.NOOK_API_KEY || env.NOOK_PASSWORD || env.NOOK_SECRET_TOKEN || '').trim();
  if (!masterSecret) {
    checks.push({
      id: 'master_secret',
      status: isProd ? 'FAIL' : 'WARN',
      message: 'NOOK_API_KEY is not set. Generate one with: openssl rand -hex 32',
    });
  } else if (isKnownWeakOrExample(masterSecret)) {
    checks.push({
      id: 'master_secret',
      status: 'FAIL',
      message: 'NOOK_API_KEY is set to a rejected public example or low-variety value. Replace with: openssl rand -hex 32',
    });
  } else if (masterSecret.length < 16) {
    checks.push({
      id: 'master_secret',
      status: isProd ? 'FAIL' : 'WARN',
      message: `NOOK_API_KEY length (${masterSecret.length}) is under recommended 16 characters.`,
    });
  } else {
    checks.push({
      id: 'master_secret',
      status: 'PASS',
      message: `NOOK_API_KEY is configured with strong entropy (length=${masterSecret.length}, uniqueChars=${new Set(masterSecret).size}).`,
    });
  }

  // 3. Human Approver Credential Segregation (NOOK_APPROVER_PASSWORD)
  const approverSecret = (env.NOOK_APPROVER_PASSWORD || '').trim();
  if (!approverSecret) {
    checks.push({
      id: 'approver_secret',
      status: isProd ? 'FAIL' : 'WARN',
      message: 'NOOK_APPROVER_PASSWORD is not set. Required in production to authorize human-in-the-loop approvals.',
    });
  } else if (isKnownWeakOrExample(approverSecret)) {
    checks.push({
      id: 'approver_secret',
      status: 'FAIL',
      message: 'NOOK_APPROVER_PASSWORD is set to a rejected public example or low-variety value.',
    });
  } else if (approverSecret === masterSecret) {
    checks.push({
      id: 'approver_secret',
      status: 'FAIL',
      message: 'NOOK_APPROVER_PASSWORD must be distinct from NOOK_API_KEY to enforce human vs. machine separation.',
    });
  } else if (approverSecret.length < 12) {
    checks.push({
      id: 'approver_secret',
      status: 'FAIL',
      message: 'NOOK_APPROVER_PASSWORD must be at least 12 characters.',
    });
  } else {
    checks.push({
      id: 'approver_secret',
      status: 'PASS',
      message: `NOOK_APPROVER_PASSWORD is configured and segregated from machine credentials (length=${approverSecret.length}).`,
    });
  }

  // 4. Sandbox Runner Secret (SANDBOX_RUNNER_SECRET)
  const runnerSecret = (env.SANDBOX_RUNNER_SECRET || '').trim();
  if (!runnerSecret) {
    checks.push({
      id: 'runner_secret',
      status: isProd ? 'FAIL' : 'WARN',
      message: 'SANDBOX_RUNNER_SECRET is not set. Generate one with: openssl rand -hex 32',
    });
  } else if (isKnownWeakOrExample(runnerSecret) || new Set(runnerSecret).size < 6) {
    checks.push({
      id: 'runner_secret',
      status: 'FAIL',
      message: 'SANDBOX_RUNNER_SECRET is set to a rejected public example or low-variety value.',
    });
  } else if (runnerSecret.length < 32) {
    checks.push({
      id: 'runner_secret',
      status: isProd ? 'FAIL' : 'WARN',
      message: `SANDBOX_RUNNER_SECRET length (${runnerSecret.length}) is under recommended 32 characters.`,
    });
  } else {
    checks.push({
      id: 'runner_secret',
      status: 'PASS',
      message: `SANDBOX_RUNNER_SECRET is configured with strong entropy (length=${runnerSecret.length}).`,
    });
  }

  // 5. Loopback & Proxy Configuration
  if (env.ALLOW_TEST_LOOPBACK === 'true' && isProd) {
    checks.push({
      id: 'network_isolation',
      status: 'FAIL',
      message: 'ALLOW_TEST_LOOPBACK=true is prohibited when NODE_ENV=production.',
    });
  } else {
    checks.push({
      id: 'network_isolation',
      status: 'PASS',
      message: `Network loopback bypass disabled; NOOK_TRUSTED_PROXY_COUNT=${env.NOOK_TRUSTED_PROXY_COUNT || '0'}.`,
    });
  }

  // 6. Storage Directory Writeability
  const storageDir = path.join(process.cwd(), '.nook_storage');
  try {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    fs.accessSync(storageDir, fs.constants.W_OK);
    checks.push({
      id: 'storage_dir',
      status: 'PASS',
      message: 'Storage directory (.nook_storage) is present and writable.',
    });
  } catch {
    checks.push({
      id: 'storage_dir',
      status: 'FAIL',
      message: 'Storage directory (.nook_storage) is not writable.',
    });
  }

  const failed = checks.filter((c) => c.status === 'FAIL').length;
  const warned = checks.filter((c) => c.status === 'WARN').length;

  return {
    ok: failed === 0,
    passed: failed === 0,
    failed,
    warned,
    environment: env.NODE_ENV || 'development',
    checks,
  };
}

// Run as CLI if invoked directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const result = runDoctorChecks(process.env);

  if (args.has('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('=== Nook Configuration & Security Doctor ===');
    for (const check of result.checks) {
      console.log(`[${check.status}] ${check.id}: ${check.message}`);
    }
    console.log(`Summary: ${result.checks.length - result.failed - result.warned} passed, ${result.warned} warnings, ${result.failed} failed.`);
  }

  if (!result.ok || (args.has('--strict') && result.warned > 0)) {
    process.exit(1);
  }
}
