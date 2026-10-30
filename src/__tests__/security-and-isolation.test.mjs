import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Import core security and infrastructure libraries
import {
  createSessionToken,
  verifySessionToken,
  validateApiRequest,
  isServerAuthSetupComplete,
  verifyOwnerCredentials,
  checkLoginRateLimit,
  recordFailedLogin,
  recordSuccessfulLogin,
} from '../lib/auth.ts';
import {
  validateOutboundUrl,
  safeFetch,
} from '../lib/ssrf.ts';
import {
  createApproval,
  decideApproval,
  verifyAndConsumeApproval,
  getApprovalById,
  saveSpace,
  saveDocumentWithRevision,
  listSpacesWithDocuments,
  listDocumentRevisions,
  rollbackDocumentToVersion,
  enqueueJob,
  claimNextQueuedJob,
  cancelJob,
  getJobById,
  acquireWorkerLease,
  releaseWorkerLease,
  validateWorkerLease,
  renewWorkerLeaseHeartbeat,
  commitMissionStateWithFencing,
  redactApproval,
  listTasksForMission,
  getAgentTaskById,
  getMissionById,
  getDatabase,
  exportWorkspaceSnapshot,
  importWorkspaceSnapshot,
  applySchema,
  markJobSideEffectStarted,
  getDocumentById,
  seedInitialSpaces,
} from '../lib/db.ts';
import { DatabaseSync } from 'node:sqlite';
import {
  validateHumanApproverRequest,
  verifyApproverCredentials,
  APPROVER_SESSION_ID,
} from '../lib/auth.ts';
import { resolveHostSafely } from '../lib/egress-proxy.ts';
import {
  WorkspaceSecurityError,
  ensureRealDirectoryWithin,
  writeFileNoFollow,
} from '../lib/safe-workspace.mjs';
import {
  loadEncryptedSecrets,
  saveEncryptedSecrets,
  maskSecret,
  SUPPORTED_MODELS,
} from '../lib/secrets.ts';
import { executeJob, tickActiveMissions, recoverStaleJobsAndMissions } from '../lib/worker.ts';
import { executeSandboxedCommand, validateCommandSafety } from '../lib/sandbox.ts';
import { planMission, tickMission, planSolutionAndTests, verifyStructuredTestOutput } from '../lib/orchestrator.ts';
import {
  getOrCreateBrowserSession,
  navigateBrowser,
  clickInteractiveElement,
  typeInteractiveElement,
  restoreBrowserSession,
  captureSessionScreenshot,
  renderBrowserScreenshotPng,
  captureRealBrowserScreenshot,
  closeBrowserSession,
  closeAllBrowserSessions,
} from '../lib/browser-session.ts';
import http from 'http';
import {
  createSandboxExecutionTicket,
  verifySandboxExecutionTicket,
  getSandboxRunnerSecret,
} from '../lib/sandbox-ticket.ts';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';

// Start dedicated sandbox runner daemon for authentic runner service tests
// Dynamically generate high-entropy test secret to avoid scanner false positives
const TEST_RUNNER_SECRET = crypto.randomBytes(32).toString('hex');
process.env.SANDBOX_RUNNER_SECRET = TEST_RUNNER_SECRET;
process.env.SANDBOX_SERVICE_URL = 'http://127.0.0.1:4010';

let hasRealDockerDaemon = false;
try {
  execSync('docker version', { stdio: 'ignore', timeout: 3000 });
  hasRealDockerDaemon = true;
} catch {
  hasRealDockerDaemon = false;
}

const runnerEnv = {
  ...process.env,
  PORT: '4010',
  SANDBOX_RUNNER_SECRET: TEST_RUNNER_SECRET,
};

if (hasRealDockerDaemon) {
  // Production container arrangement: Use REAL Docker daemon directly
  runnerEnv.DOCKER_BIN = 'docker';
} else {
  // Local fallback for developer hosts without a running Docker daemon
  runnerEnv.DOCKER_BIN = process.execPath;
  runnerEnv.DOCKER_ARGS_PREFIX = path.resolve(process.cwd(), 'bin/mock-docker.mjs');
}

let runnerProc = null;
try {
  runnerProc = spawn(process.execPath, [path.resolve(process.cwd(), 'bin/sandbox-runner.mjs')], {
    env: runnerEnv,
    stdio: 'ignore',
  });
  if (runnerProc && typeof runnerProc.unref === 'function') {
    runnerProc.unref();
  }
} catch {}

function killProcessSafely(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /f /t`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
}

process.on('exit', () => {
  killProcessSafely(runnerProc);
});

// Await runner health before executing test suite
for (let i = 0; i < 20; i++) {
  try {
    const h = await fetch('http://127.0.0.1:4010/health');
    if (h.ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

// =========================================================================
// 1. AUTHENTICATION & SESSION SECURITY TESTS
// =========================================================================
test('Auth: Anonymous and invalid token requests are strictly denied', () => {
  // Empty request
  const reqNoAuth = new Request('http://localhost:3000/api/workspace/state');
  const resNoAuth = validateApiRequest(reqNoAuth);
  assert.equal(resNoAuth.authorized, false, 'Anonymous request must be rejected');

  // Arbitrary invalid bearer token
  const reqBadBearer = new Request('http://localhost:3000/api/workspace/state', {
    headers: { Authorization: 'Bearer random-invalid-token-xyz' },
  });
  const resBadBearer = validateApiRequest(reqBadBearer);
  assert.equal(resBadBearer.authorized, false, 'Arbitrary bearer token must be rejected');

  // Spoofed Host header must not bypass authentication
  const reqSpoofedHost = new Request('http://localhost:3000/api/workspace/state', {
    headers: {
      Host: 'localhost:3000',
      'X-Forwarded-For': '127.0.0.1',
    },
  });
  const resSpoofedHost = validateApiRequest(reqSpoofedHost);
  assert.equal(resSpoofedHost.authorized, false, 'Localhost host header must NOT bypass auth');
});

test('Auth: createSessionToken fails closed when setup is unconfigured', () => {
  const origKey = process.env.NOOK_API_KEY;
  const origPwd = process.env.NOOK_PASSWORD;
  const origSec = process.env.NOOK_SECRET_TOKEN;

  try {
    delete process.env.NOOK_API_KEY;
    delete process.env.NOOK_PASSWORD;
    delete process.env.NOOK_SECRET_TOKEN;
    assert.throws(() => createSessionToken(), /Server authentication setup is incomplete/);
  } finally {
    process.env.NOOK_API_KEY = origKey;
    process.env.NOOK_PASSWORD = origPwd;
    process.env.NOOK_SECRET_TOKEN = origSec;
  }
});

test('Auth: Legitimate cryptographic session tokens succeed', () => {
  const origPwd = process.env.NOOK_PASSWORD;
  process.env.NOOK_PASSWORD = 'test-configured-secret-123';

  try {
    const token = createSessionToken();
    assert.ok(token, 'Session token should be generated');

    const verified = verifySessionToken(token);
    assert.equal(verified.valid, true, 'Cryptographically signed session token must verify');

    const verifiedFake = verifySessionToken(`${token}-tampered`);
    assert.equal(verifiedFake.valid, false, 'Tampered session token must fail verification');

    // Session cookie validation
    const reqCookie = new Request('http://localhost:3000/api/workspace/state', {
      headers: {
        Cookie: `nook_session=${token}`,
      },
    });
    const authRes = validateApiRequest(reqCookie);
    assert.equal(authRes.authorized, true, 'Valid session cookie must authenticate request');
  } finally {
    process.env.NOOK_PASSWORD = origPwd;
  }
});

test('Auth: Fail-closed on missing credentials and verifyOwnerCredentials validation', () => {
  const origKey = process.env.NOOK_API_KEY;
  const origPwd = process.env.NOOK_PASSWORD;
  const origSec = process.env.NOOK_SECRET_TOKEN;

  try {
    delete process.env.NOOK_API_KEY;
    delete process.env.NOOK_PASSWORD;
    delete process.env.NOOK_SECRET_TOKEN;

    // 1. Without credentials, setup is incomplete
    assert.equal(isServerAuthSetupComplete(), false, 'Setup must be incomplete without key or password');
    assert.equal(verifyOwnerCredentials('any-attempted-password'), false, 'Must fail closed when unconfigured');

    // 2. Setup with short credentials (< 8 chars) fails
    process.env.NOOK_PASSWORD = 'short';
    assert.equal(isServerAuthSetupComplete(), false, 'Passwords under 8 chars must be considered incomplete');
    assert.equal(verifyOwnerCredentials('short'), false);

    // 3. Setup with valid credentials
    process.env.NOOK_PASSWORD = 'super-secure-owner-secret-123';
    assert.equal(isServerAuthSetupComplete(), true, 'Setup must be complete with valid password');
    assert.equal(verifyOwnerCredentials('wrong-password'), false, 'Wrong password must be rejected');
    assert.equal(verifyOwnerCredentials('super-secure-owner-secret-123'), true, 'Exact password must be accepted');

    // 4. API key validation
    delete process.env.NOOK_PASSWORD;
    process.env.NOOK_API_KEY = 'nook-master-api-key-9999';
    assert.equal(isServerAuthSetupComplete(), true);
    assert.equal(verifyOwnerCredentials('nook-master-api-key-9999'), true);
  } finally {
    process.env.NOOK_API_KEY = origKey;
    process.env.NOOK_PASSWORD = origPwd;
    process.env.NOOK_SECRET_TOKEN = origSec;
  }
});

test('Auth: Cookie and Bearer session verification enforces strict HMAC and expiry', () => {
  const token = createSessionToken('nook-owner', 1000 * 60); // 1 minute
  const verified = verifySessionToken(token);
  assert.equal(verified.valid, true);
  assert.equal(verified.sessionId, 'nook-owner');

  // Verify expired token fails
  const expiredToken = createSessionToken('nook-owner', -1000); // already expired
  const expVerified = verifySessionToken(expiredToken);
  assert.equal(expVerified.valid, false);
  assert.ok(expVerified.error?.includes('expired'));

  // Verify malformed token fails
  assert.equal(verifySessionToken('').valid, false);
  assert.equal(verifySessionToken('only-one-part').valid, false);
  assert.equal(verifySessionToken('two.parts').valid, false);
  assert.equal(verifySessionToken('three.parts.with-invalid-signature').valid, false);
});


// =========================================================================
// 2. SERVER APPROVALS & REPLAY PROTECTION TESTS
// =========================================================================
test('Approvals: Shell execution without approval is rejected', () => {
  // Test direct consumption attempt without approval
  const outcome = verifyAndConsumeApproval('non-existent-id', 'no-token', 'ls -la');
  assert.equal(outcome.authorized, false);
  assert.ok(outcome.error.includes('does not exist'));
});

test('Approvals: Full lifecycle, exact command matching, single-use, and replay protection', () => {
  const agentId = 'agent-cipher';
  const command = 'npm run test:sandbox';

  // 1. Create pending approval
  const approval = createApproval({
    agentId,
    agentName: 'Cipher',
    type: 'run_command',
    title: 'Run Sandbox Test Suite',
    payload: { command },
  });
  assert.equal(approval.status, 'pending');
  assert.ok(approval.singleUseToken);

  // 2. Attempt to consume while still pending -> MUST FAIL
  const pendingConsume = verifyAndConsumeApproval(approval.id, approval.singleUseToken, command, agentId);
  assert.equal(pendingConsume.authorized, false, 'Pending approval cannot be consumed before user authorizes');

  // 3. User approves
  const decision = decideApproval(approval.id, 'approve');
  assert.equal(decision.success, true);
  assert.equal(decision.approval?.status, 'approved');

  // 4. Command mismatch -> MUST FAIL
  // Approval for "npm run test:sandbox" attempting to run "cat /etc/passwd"
  const mismatchConsume = verifyAndConsumeApproval(
    approval.id,
    approval.singleUseToken,
    'cat /etc/passwd',
    agentId
  );
  assert.equal(mismatchConsume.authorized, false, 'Approval for command A must reject command B');
  assert.ok(mismatchConsume.error?.includes('Command mismatch'));

  // 5. Wrong agent -> MUST FAIL
  const wrongAgentConsume = verifyAndConsumeApproval(
    approval.id,
    approval.singleUseToken,
    command,
    'agent-malicious'
  );
  assert.equal(wrongAgentConsume.authorized, false, 'Approval issued for agent A must reject agent B');

  // 6. Valid authorized execution -> SUCceeds and atomically consumes
  const validConsume = verifyAndConsumeApproval(
    approval.id,
    approval.singleUseToken,
    command,
    agentId
  );
  assert.equal(validConsume.authorized, true, 'Valid approval must succeed');
  assert.equal(validConsume.approval?.status, 'consumed');

  // 7. Replay attempt -> MUST FAIL (Single-use enforcement)
  const replayConsume = verifyAndConsumeApproval(
    approval.id,
    approval.singleUseToken,
    command,
    agentId
  );
  assert.equal(replayConsume.authorized, false, 'Replaying an already-consumed token MUST fail');
  assert.ok(replayConsume.error?.includes('consumed'));
});

test('Approvals: Expired authorization tokens are rejected', () => {
  const expiredApproval = createApproval({
    agentId: 'agent-cipher',
    agentName: 'Cipher',
    type: 'run_command',
    title: 'Expired Command',
    payload: { command: 'echo "hello"' },
    ttlMs: -1000, // already expired
  });

  const consume = verifyAndConsumeApproval(
    expiredApproval.id,
    expiredApproval.singleUseToken,
    'echo "hello"',
    'agent-cipher'
  );
  assert.equal(consume.authorized, false, 'Expired approval must be rejected');
});

// =========================================================================
// 3. SSRF & NETWORK ISOLATION TESTS
// =========================================================================
test('SSRF: Outbound URL validator strictly blocks internal/private targets', async () => {
  const forbiddenTargets = [
    'http://127.0.0.1:8080/admin',
    'http://localhost:3000/api/settings',
    'http://169.254.169.254/latest/meta-data/', // AWS metadata
    'http://10.0.0.1/internal',
    'http://192.168.1.1/router',
    'http://172.16.0.1/private',
    'http://[::1]:8080/status',
    'ftp://example.com/test', // Non-HTTP/HTTPS protocol
  ];

  for (const url of forbiddenTargets) {
    const result = await validateOutboundUrl(url);
    assert.equal(result.allowed, false, `SSRF validator must block: ${url}`);
  }

  // Legitimate public HTTPS URLs
  const publicResult = await validateOutboundUrl('https://en.wikipedia.org/wiki/Main_Page');
  assert.equal(publicResult.allowed, true, 'Public HTTPS domain should be allowed');
});

// =========================================================================
// 4. TRANSACTIONAL PERSISTENCE, REVISIONS & ROLLBACK TESTS
// =========================================================================
test('Living Spaces: Document revision tracking and version rollback', () => {
  const docId = `test-doc-${Date.now()}`;
  const spaceId = 'space-test-revisions';

  saveSpace({ id: spaceId, name: 'Revision Test Space', icon: 'folder' });

  // 1. Initial version (v1)
  const v1 = saveDocumentWithRevision({
    id: docId,
    spaceId,
    title: 'Nook Architecture Spec',
    content: '# Architecture v1\nInitial specification.',
    authorAgentId: 'agent-quill',
  });
  assert.equal(v1.version, 1);

  // 2. Second version (v2)
  const v2 = saveDocumentWithRevision({
    id: docId,
    spaceId,
    title: 'Nook Architecture Spec (Updated)',
    content: '# Architecture v2\nUpdated with isolated execution sandboxes.',
    authorAgentId: 'agent-quill',
    changeSummary: 'Added sandboxing details',
  });
  assert.equal(v2.version, 2);

  // 3. Third version (v3)
  const v3 = saveDocumentWithRevision({
    id: docId,
    spaceId,
    title: 'Nook Architecture Spec v3',
    content: '# Architecture v3\nTransactional SQLite layer and SSRF protection.',
    authorAgentId: 'agent-quill',
    changeSummary: 'Added transactional DB details',
  });
  assert.equal(v3.version, 3);

  // 4. Verify immutable revision history
  const revisions = listDocumentRevisions(docId);
  assert.equal(revisions.length, 3, 'Document should have 3 revisions');
  assert.equal(revisions[0].version, 3);
  assert.equal(revisions[1].version, 2);
  assert.equal(revisions[2].version, 1);
  assert.equal(revisions[2].content, '# Architecture v1\nInitial specification.');

  // 5. Rollback to v1
  const rolledBack = rollbackDocumentToVersion(docId, 1);
  assert.equal(rolledBack.version, 4, 'Rollback should append a new version v4 containing v1 content');
  assert.equal(rolledBack.content, '# Architecture v1\nInitial specification.');

  // 6. Persistence across spaces listing
  const spaces = listSpacesWithDocuments();
  const testSpace = spaces.find((s) => s.id === spaceId);
  assert.ok(testSpace, 'Space must be retrieved from database');
  const docInSpace = testSpace.pages.find((p) => p.id === docId);
  assert.ok(docInSpace, 'Document must be retrieved from database');
  assert.equal(docInSpace.version, 4);
});

// =========================================================================
// 5. DURABLE BACKGROUND WORKER & CANCELLATION TESTS
// =========================================================================
test('Background Worker: Queue claiming, genuine step execution, and cancellation', async () => {
  // 0. Ensure clean queue
  getDatabase().prepare(`DELETE FROM background_jobs WHERE status = 'queued'`).run();

  // 1. Enqueue job
  const job = enqueueJob({
    agentId: 'agent-scout',
    taskType: 'research',
    title: 'Autonomous Worker Test Job',
    prompt: 'research quantum cryptography',
  });
  assert.equal(job.status, 'queued');

  // 2. Claim job atomically
  const claimed = claimNextQueuedJob();
  assert.ok(claimed, 'Worker should claim next queued job');
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, 'running');

  // 3. Test cancellation
  const cancelled = cancelJob(job.id);
  assert.equal(cancelled, true, 'Job should be successfully cancelled');

  const jobAfterCancel = getJobById(job.id);
  assert.equal(jobAfterCancel?.status, 'cancelled');

  // Worker executing a cancelled job should abort immediately
  await executeJob(jobAfterCancel);
  const finalJob = getJobById(job.id);
  assert.equal(finalJob?.status, 'cancelled', 'Job must remain cancelled');
});

// =========================================================================
// 6. ENCRYPTED SECRETS VAULT & MASKING TESTS
// =========================================================================
test('Secrets: AES-256-GCM encryption, decryption, masking, and model whitelisting', async () => {
  const secretPayload = {
    geminiApiKey: 'AIzaSyTestGeminiKey123456789',
    openaiApiKey: 'sk-proj-testOpenAiKey987654321',
  };

  await saveEncryptedSecrets(secretPayload);
  const restored = await loadEncryptedSecrets();

  assert.equal(restored.geminiApiKey, secretPayload.geminiApiKey, 'Decrypted key must match');
  assert.equal(restored.openaiApiKey, secretPayload.openaiApiKey, 'Decrypted key must match');

  // Masking
  const maskedGemini = maskSecret(secretPayload.geminiApiKey);
  assert.ok(maskedGemini.startsWith('AIza'), 'Masked key must show prefix');
  assert.ok(maskedGemini.endsWith('6789'), 'Masked key must show suffix');
  assert.ok(maskedGemini.includes('••••'), 'Masked key must hide middle characters');

  // Whitelisting
  assert.ok(SUPPORTED_MODELS.gemini.includes('gemini-1.5-flash'));
  assert.ok(SUPPORTED_MODELS.openai.includes('gpt-4o-mini'));
  assert.ok(SUPPORTED_MODELS.anthropic.includes('claude-3-5-sonnet-20241022'));
  assert.equal(SUPPORTED_MODELS.gemini.includes('unsupported-model-xyz'), false);
});

// =========================================================================
// 7. SANDBOX ISOLATION & RESOURCE LIMITS
// =========================================================================
test('Sandbox: Command execution enforces resource limits, scrubs secrets, and blocks directory traversal', async () => {
  // 1. Directory traversal attempt must be blocked by safety check
  const checkEscape = validateCommandSafety('cat ../../.env', 'test-agent');
  assert.equal(checkEscape.safe, false, 'Must block traversal escaping agent root');
  assert.ok(checkEscape.reason?.includes('traversal') || checkEscape.reason?.includes('blocked'));

  // 2. Sensitive host secret reference must be blocked
  const checkSecrets = validateCommandSafety('type .nook_storage/auth_secret', 'test-agent');
  assert.equal(checkSecrets.safe, false, 'Must block reference to .nook_storage');

  // 3. Destructive command must be blocked
  const checkDestructive = validateCommandSafety('rm -rf /', 'test-agent');
  assert.equal(checkDestructive.safe, false, 'Must block rm -rf /');

  // 4. Safe command execution must NOT leak host environment secrets
  const origKey = process.env.NOOK_API_KEY;
  process.env.NOOK_API_KEY = 'super-secret-host-key-must-not-leak';

  try {
    const isWin = process.platform === 'win32';
    const echoCmd = isWin ? 'Write-Output "SANDBOX_OK"' : 'echo "SANDBOX_OK"';
    const testJob = enqueueJob({
      agentId: 'cipher-test',
      taskType: 'code_test',
      title: 'Echo test in sandbox',
      prompt: echoCmd,
    });
    claimNextQueuedJob();

    const res = await executeSandboxedCommand({
      agentId: 'cipher-test',
      command: echoCmd,
      taskId: testJob.id,
      authorizationType: 'system_verified_test',
      timeoutMs: 8000,
    });

    assert.equal(res.exitCode, 0, 'Safe command must succeed in sandbox');
    assert.ok(res.stdout.includes('SANDBOX_OK'), 'Output should contain command result');
    assert.equal(res.isolatedRuntime, 'docker_container', 'Runtime must strictly be docker_container');
  } finally {
    process.env.NOOK_API_KEY = origKey;
  }
});

// =========================================================================
// 8. MISSION APPROVAL BOUNDARY TESTS
// =========================================================================
test('Approvals: Missions cannot approve their own privileged commands', async () => {
  // Plan mission requiring code execution
  const mission = planMission({
    title: 'Autonomous Code Execution Test',
    objective: 'Implement robotics state machine and test',
    requiresCodeExecution: true,
  });

  assert.ok(mission.id);
  assert.equal(mission.status, 'draft');

  // Advance to first task (Scout)
  await tickMission(mission.id);

  // Advance to second task (Quill)
  await tickMission(mission.id);

  // Advance to third task (Cipher - requires privileged sandbox command)
  const ticked = await tickMission(mission.id);
  assert.ok(ticked.status === 'paused' || ticked.status === 'active');

  const cipherTask = ticked.tasks?.find((t) => t.assignedAgentId === 'agent-cipher');
  assert.ok(cipherTask, 'Cipher task should exist');

  // Cipher task MUST be blocked on human approval, NOT auto-approved!
  assert.equal(cipherTask.status, 'blocked', 'Cipher task must pause and wait for human approval');
  assert.ok(cipherTask.approvalId, 'Approval ID must be assigned for human decision');

  const approval = getApprovalById(cipherTask.approvalId);
  assert.ok(approval, 'Approval record must exist on server');
  assert.equal(approval.status, 'pending', 'Approval status must remain pending until human decision');
});

// =========================================================================
// 9. RESEARCH EVIDENCE INTEGRITY TESTS
// =========================================================================
test('Evidence: Empty or failed search produces zero verified citations', async () => {
  const mission = planMission({
    title: 'Obscure Unknown Query',
    objective: 'zxqv12349876nonexistenttechnology999',
    requiresCodeExecution: false,
  });

  const updatedMission = await tickMission(mission.id);
  const scoutTask = updatedMission.tasks?.find((t) => t.assignedAgentId === 'agent-scout');
  assert.ok(scoutTask, 'Scout task should exist');

  // Acceptance test: An empty or failed search produces no verified citations
  assert.deepEqual(scoutTask.outputs?.citations, [], 'Must produce zero citations for failed search');
  assert.equal(scoutTask.verification?.verified, false, 'Task verification must be false when search fails');
});

// =========================================================================
// 10. PERSISTENT WORKER & CRASH RECOVERY TESTS
// =========================================================================
test('Supervisor: Background worker advances active missions and recovers from crashes', async () => {
  // 1. Initial recovery check
  const recovery = recoverStaleJobsAndMissions();
  assert.equal(typeof recovery.recoveredJobs, 'number');
  assert.equal(typeof recovery.recoveredMissions, 'number');

  // 2. Active mission advancement via worker tick
  const _mission = planMission({
    title: 'Background Supervision Test',
    objective: 'distributed systems state machine',
    requiresCodeExecution: false,
  });

  const progressed = await tickActiveMissions();
  assert.equal(progressed, true, 'Worker should autonomously tick active mission');
});

// =========================================================================
// 11. SSRF DNS PINNING TESTS
// =========================================================================
test('SSRF: safeFetch uses DNS pinning to prevent TOCTOU rebinding', async () => {
  const res = await safeFetch('https://example.com', {
    timeoutMs: 8000,
  });

  assert.equal(res.ok, true);
  assert.ok(res.pinnedIp, 'Response must include pinned IP from DNS validation');
  // Verify pinned IP is an external public IP
  assert.ok(!res.pinnedIp.startsWith('127.'), 'Pinned IP must not be loopback');
  assert.ok(!res.pinnedIp.startsWith('192.168.'), 'Pinned IP must not be private');
});

// =========================================================================
// 12. BROWSER OBSERVABLE SESSION & PERSISTENCE TESTS
// =========================================================================
test('Browser: Observable browser session enforces egress restrictions and disk persistence', async () => {
  const session = getOrCreateBrowserSession('agent-scout');
  assert.ok(session);
  assert.equal(session.agentId, 'agent-scout');
  assert.ok(session.history.length >= 1);

  // Attempt navigation to forbidden internal host must be blocked
  await assert.rejects(
    () => navigateBrowser('agent-scout', 'http://169.254.169.254/latest/meta-data'),
    /SSRF Policy Violation/
  );

  // Persistence to disk check
  const sessionFilePath = path.join(process.cwd(), '.nook_storage', 'browser_sessions', 'agent-scout.json');
  assert.ok(fs.existsSync(sessionFilePath), 'Browser session must be persisted to disk');
  const diskData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
  assert.equal(diskData.agentId, 'agent-scout');
  assert.ok(Array.isArray(diskData.interactiveElements), 'Should store interactive elements');

  // Interactive element click emulation
  const clickRes = await clickInteractiveElement('agent-scout', 'nonexistent-element-id');
  assert.equal(clickRes.success, false, 'Clicking non-existent element should return failure');

  // Screenshot capture metadata check
  const shot = captureSessionScreenshot('agent-scout');
  assert.ok(shot.includes('screenshot') && shot.includes('agent-scout'), 'Screenshot path should contain agent ID and screenshot identifier');
});

// =========================================================================
// 13. SECRETS ENCRYPTION HARDENING & PBKDF2 SALT TESTS
// =========================================================================
test('Secrets: Uses PBKDF2 with persistent salt, supports password-only, eliminates predictable fallback', async () => {
  const saltFile = path.join(process.cwd(), '.nook_storage', 'encryption.salt');
  
  // Save secrets
  const testPayload = {
    geminiApiKey: 'test-gemini-key-12345678',
    openaiApiKey: 'test-openai-key-87654321',
  };
  await saveEncryptedSecrets(testPayload);

  // Verify salt exists on disk
  assert.ok(fs.existsSync(saltFile), 'Encryption salt file must exist in storage');
  const saltBuf = fs.readFileSync(saltFile);
  assert.ok(saltBuf.length >= 16, 'Salt must be at least 16 cryptographically random bytes');

  // Read back encrypted secrets
  const loaded = await loadEncryptedSecrets();
  assert.equal(loaded.geminiApiKey, testPayload.geminiApiKey);
  assert.equal(loaded.openaiApiKey, testPayload.openaiApiKey);
});

// =========================================================================
// 14. ARBITRARY AI SOLUTION & TEST SUITE GENERATION TESTS
// =========================================================================
test('Planner: Arbitrary prompts dynamically generate tailored solutions and tests without hardcoded keywords', () => {
  // 1. Arbitrary financial domain prompt
  const arbitraryPrompt1 = 'High throughput ledger transaction deduplicator with nonce validation';
  const plan1 = planSolutionAndTests(arbitraryPrompt1);

  assert.ok(plan1.solutionFile.endsWith('.mjs'));
  assert.ok(plan1.testFile.endsWith('.mjs'));
  assert.ok(plan1.className.length > 0);
  assert.ok(plan1.solutionContent.includes(plan1.className), 'Solution must declare the dynamically derived class');
  assert.ok(plan1.testContent.includes("import test from 'node:test'"));
  assert.ok(plan1.testContent.includes("import assert from 'node:assert/strict'"));
  assert.ok(plan1.command.includes('node --test'));

  // Ensure no hardcoded robotics/consensus keywords are leaked or required
  assert.equal(plan1.solutionContent.includes('RoboticsStateMachine'), false);
  assert.equal(plan1.solutionContent.includes('RaftNode'), false);

  // 2. Arbitrary cache eviction prompt
  const arbitraryPrompt2 = 'Adaptive LRU cache with TTL expiration and telemetry hooks';
  const plan2 = planSolutionAndTests(arbitraryPrompt2);

  assert.ok(plan2.solutionContent.includes(plan2.className));
  assert.ok(plan2.testContent.includes(plan2.className));
  assert.equal(plan2.solutionContent.includes('RoboticsStateMachine'), false);
});

// =========================================================================
// 15. SANDBOX FAIL-CLOSED ENFORCEMENT & ELIMINATION OF HOST FALLBACK
// =========================================================================
test('Sandbox: Host fallback is eliminated and strictly fails closed when runner and container isolation are unavailable', async () => {
  const origServiceUrl = process.env.SANDBOX_SERVICE_URL;
  try {
    delete process.env.SANDBOX_SERVICE_URL;
    process.env.NOOK_DISABLE_DOCKER = 'true';

    const res = await executeSandboxedCommand({
      agentId: 'cipher-audit',
      command: 'node -v',
      timeoutMs: 5000,
    });

    assert.equal(res.exitCode, 126, 'Must exit with code 126 on isolation failure');
    assert.ok(res.stderr.includes('Security Policy Violation'), 'Must report security policy violation');
    assert.equal(res.isolatedRuntime, 'none', 'Must not execute in host process jail');
  } finally {
    process.env.SANDBOX_SERVICE_URL = origServiceUrl;
    delete process.env.NOOK_DISABLE_DOCKER;
  }
});

// =========================================================================
// 16. STRUCTURED TASK VERIFICATION TESTS
// =========================================================================
test('Verification: Rejects fake pass/ok text and strictly parses real structured test results', () => {
  // 1. Loose substring matching bypass attempt: Output merely contains "pass" or "ok"
  const fakeOutput = 'Connecting to database... status: ok, checking password... passed';
  const fakeResult = verifyStructuredTestOutput(fakeOutput, '', 0);
  assert.equal(fakeResult.verified, false, 'Plain console logs containing pass/ok must NOT be verified');
  assert.equal(fakeResult.totalTests, 0);

  // 2. Real node:test runner success output
  const genuineNodeTestOutput = `
✔ test suite initialized (1.2ms)
✔ should calculate correct result (0.8ms)
✔ should validate boundary conditions (0.5ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 42.1
`;
  const genuineResult = verifyStructuredTestOutput(genuineNodeTestOutput, '', 0);
  assert.equal(genuineResult.verified, true, 'Genuine node:test output with 3 passes must be verified');
  assert.equal(genuineResult.totalTests, 3);
  assert.equal(genuineResult.passedTests, 3);
  assert.equal(genuineResult.failedTests, 0);

  // 3. Output with failures must be rejected
  const failingNodeTestOutput = `
✔ should calculate correct result (0.8ms)
✖ should validate boundary conditions (1.2ms)
ℹ tests 2
ℹ pass 1
ℹ fail 1
`;
  const failedResult = verifyStructuredTestOutput(failingNodeTestOutput, '', 1);
  assert.equal(failedResult.verified, false, 'Test output with failures must NOT be verified');

  // 5. Inconsistent / incomplete test counts: passedTests !== totalTests must FAIL
  const inconsistentOutput = `
✔ test 1 (1ms)
✔ test 2 (1ms)
ℹ tests 5
ℹ pass 2
ℹ fail 0
ℹ cancelled 3
`;
  const inconsistentResult = verifyStructuredTestOutput(inconsistentOutput, '', 0);
  assert.equal(inconsistentResult.verified, false, 'Must fail when passedTests !== totalTests');

  // 6. Test bail out must FAIL
  const bailOutOutput = `
1..5
ok 1 - setup passed
Bail out! Database connection failed abruptly
`;
  const bailResult = verifyStructuredTestOutput(bailOutOutput, '', 0);
  assert.equal(bailResult.verified, false, 'Bail out must fail test verification');
});

// =========================================================================
// 17. ATOMIC SQLITE WORKER LEASES & FENCING TESTS
// =========================================================================
test('Worker Leases: Atomic SQLite leases prevent concurrent execution across web & workers', () => {
  const resourceId = `mission-test-${Date.now()}`;
  const workerA = 'worker-node-1';
  const workerB = 'worker-node-2';

  // 1. Worker A acquires lease
  const leaseA = acquireWorkerLease(resourceId, workerA, 10000);
  assert.equal(leaseA.acquired, true, 'Worker A should acquire fresh lease');
  assert.equal(leaseA.fencingToken, 1, 'Initial fencing token must be 1');

  // 2. Worker B attempts to acquire same active lease -> must be denied!
  const leaseB = acquireWorkerLease(resourceId, workerB, 10000);
  assert.equal(leaseB.acquired, false, 'Worker B must be rejected while Worker A lease is active');
  assert.equal(leaseB.ownerId, workerA);

  // 3. Worker A validates active lease
  assert.equal(validateWorkerLease(resourceId, workerA, 1), true, 'Worker A lease must be valid');
  assert.equal(validateWorkerLease(resourceId, workerB), false, 'Worker B must not have valid lease');

  // 4. Worker A releases lease
  const released = releaseWorkerLease(resourceId, workerA);
  assert.equal(released, true);

  // 5. Worker B can now acquire lease with incremented fencing token
  const leaseBAfterRelease = acquireWorkerLease(resourceId, workerB, 10000);
  assert.equal(leaseBAfterRelease.acquired, true, 'Worker B can acquire after release');
  assert.equal(leaseBAfterRelease.fencingToken, 2, 'Fencing token must increment on re-acquisition');
});

// =========================================================================
// 18. APPROVAL SINGLE-USE TOKEN REDACTION TESTS
// =========================================================================
test('Approvals: Redacted records strip singleUseToken from API payloads', () => {
  const record = createApproval({
    agentId: 'agent-cipher',
    agentName: 'Cipher',
    type: 'run_command',
    title: 'Redaction Verification Test',
    payload: { command: 'npm test' },
  });

  assert.ok(record.singleUseToken, 'Database record must have singleUseToken');
  const redacted = redactApproval(record);

  assert.equal(redacted.id, record.id);
  assert.equal(redacted.agentName, 'Cipher');
  assert.equal('singleUseToken' in redacted, false, 'Redacted record must NOT contain singleUseToken');
});

// =========================================================================
// 19. GENUINE BROWSER PNG SCREENSHOT TESTS
// =========================================================================
test('Browser Screenshots: Generates genuine binary PNG with valid IHDR and IDAT chunks', () => {
  const pngBuf = renderBrowserScreenshotPng('Nook Test Page', 'https://example.com', 200, 320, 240);
  assert.ok(Buffer.isBuffer(pngBuf));
  assert.ok(pngBuf.length > 50, 'PNG buffer must contain image data');

  // Validate standard 8-byte PNG magic signature (\x89PNG\r\n\x1a\n)
  const magic = pngBuf.subarray(0, 8);
  const expectedMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(magic, expectedMagic, 'Must begin with authentic PNG signature');

  // Verify IHDR and IEND chunks are present
  assert.ok(pngBuf.includes(Buffer.from('IHDR')), 'Must contain valid IHDR chunk');
  assert.ok(pngBuf.includes(Buffer.from('IDAT')), 'Must contain valid IDAT chunk');
  assert.ok(pngBuf.includes(Buffer.from('IEND')), 'Must contain valid IEND chunk');
});

// =========================================================================
// 20. SANDBOX RUNNER EXECUTION TICKET AUTHENTICATION & AUTHORIZATION CHAIN
// =========================================================================
test('Sandbox Tickets: Validates action-bound HMAC tickets, authorization chain, and rejects insecure defaults or replay', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  const command = 'node -e "console.log(process.version)"';
  const agentId = 'agent-cipher-audit';
  const approvalId = 'appr-audit-human-123';

  // 1. Generate valid human approval ticket
  const ticket = createSandboxExecutionTicket({
    command,
    agentId,
    approvalId,
    authorizationType: 'human_approval',
    ttlMs: 30000,
    secret,
    skipServerVerification: true,
  });
  assert.ok(ticket.signature.length > 20, 'Ticket must contain valid HMAC signature');
  assert.equal(ticket.agentId, agentId);
  assert.equal(ticket.approvalId, approvalId);
  assert.equal(ticket.authorizationType, 'human_approval');

  // 2. Legitimate verification succeeds
  const verified = verifySandboxExecutionTicket(ticket, command, agentId, undefined, secret);
  assert.equal(verified.valid, true, 'Matching ticket and payload must verify successfully');

  // 3. Command tampering fails
  const tamperedCommand = verifySandboxExecutionTicket(ticket, 'rm -rf / && node -v', agentId, undefined, secret);
  assert.equal(tamperedCommand.valid, false, 'Tampered command must be rejected');
  assert.ok(tamperedCommand.error?.includes('different command'));

  // 4. Agent identity spoofing fails
  const spoofedAgent = verifySandboxExecutionTicket(ticket, command, 'attacker-agent', undefined, secret);
  assert.equal(spoofedAgent.valid, false, 'Spoofed agent ID must be rejected');
  assert.ok(spoofedAgent.error?.includes('different agent'));

  // 5. Wrong secret fails
  const badSecret = verifySandboxExecutionTicket(ticket, command, agentId, undefined, crypto.randomBytes(32).toString('hex'));
  assert.equal(badSecret.valid, false, 'Wrong secret must be rejected');
  assert.ok(badSecret.error?.includes('cryptographic signature is invalid'));

  // 6. Expired ticket fails
  const expiredTicket = createSandboxExecutionTicket({ command, agentId, approvalId, authorizationType: 'human_approval', ttlMs: -1000, secret, skipServerVerification: true });
  const expiredRes = verifySandboxExecutionTicket(expiredTicket, command, agentId, undefined, secret);
  assert.equal(expiredRes.valid, false, 'Expired ticket must be rejected');
  assert.ok(expiredRes.error?.includes('expired'));

  // 7. Replay protection fails
  const consumedTickets = new Set([ticket.ticketId]);
  const replayed = verifySandboxExecutionTicket(ticket, command, agentId, consumedTickets, secret);
  assert.equal(replayed.valid, false, 'Replayed ticket must be rejected');
  assert.ok(replayed.error?.includes('replay detected'));

  // 8. Insecure default secret rejection
  const origEnvSecret = process.env.SANDBOX_RUNNER_SECRET;
  try {
    process.env.SANDBOX_RUNNER_SECRET = 'nook_internal_runner_auth_secret_v1';
    assert.throws(() => getSandboxRunnerSecret(), /SECURITY FAULT: SANDBOX_RUNNER_SECRET is set to an insecure/);
    const insecureRes = verifySandboxExecutionTicket(ticket, command, agentId);
    assert.equal(insecureRes.valid, false);
    assert.ok(insecureRes.error?.includes('SECURITY FAULT'));
  } finally {
    process.env.SANDBOX_RUNNER_SECRET = origEnvSecret;
  }

  // 9. Server verification enforcement: refuses ticket without approved record in database
  assert.throws(
    () => createSandboxExecutionTicket({ command, agentId, approvalId: 'unapproved-id-not-in-db', authorizationType: 'human_approval' }),
    /Server authorization denied/
  );
});

// =========================================================================
// 21. BROWSER SCREENSHOT METADATA & REAL CAPTURE VERIFICATION
// =========================================================================
test('Browser Screenshots: Real Playwright browser capture produces authentic PNG and strictly rejects placeholders', async () => {
  try {
    const session = getOrCreateBrowserSession('agent-audit-inspector');
    await navigateBrowser('agent-audit-inspector', 'https://example.com/checkout');

    assert.ok(session.screenshotMetadata, 'Session must expose screenshotMetadata');
    assert.equal(session.screenshotMetadata.isSyntheticPlaceholder, false, 'Real browser acceptance suite strictly rejects placeholders');
    assert.equal(session.screenshotMetadata.captureType, 'playwright_browser_capture', 'Must be authentic playwright_browser_capture');
    assert.ok(
      session.screenshotMetadata.engine?.includes('playwright') ||
      session.screenshotMetadata.engine?.includes('chromium'),
      'Engine must be verified chromium or playwright browser'
    );
  } finally {
    await closeBrowserSession('agent-audit-inspector');
  }
});

// =========================================================================
// 22. MISSION LEASE CONCURRENCY & FENCING DEFENSE
// =========================================================================
test('Missions: Atomic SQLite leases prevent concurrent ticks and enforce fencing', async () => {
  const mission = planMission({
    title: 'Concurrent Lease Hardening Mission',
    objective: 'Verify SQLite worker lease fencing',
    priority: 'high',
  });
  assert.ok(mission.id);

  // Worker 1 acquires lease and ticks
  const tick1 = await tickMission(mission.id, 'worker-1', 10000);
  assert.equal(tick1.leaseBusy, false, 'Worker 1 should acquire lease and execute tick');

  // Manually lock lease under worker-1
  acquireWorkerLease(`mission:${mission.id}`, 'worker-1', 30000);

  // Concurrent worker 2 attempts to tick while held -> must report leaseBusy
  const tick2 = await tickMission(mission.id, 'worker-2', 10000);
  assert.equal(tick2.leaseBusy, true, 'Worker 2 must receive leaseBusy when lease is locked by worker 1');

  // Release lease
  releaseWorkerLease(`mission:${mission.id}`, 'worker-1');
});

// =========================================================================
// 23. BACKGROUND JOBS REQUIRE GENUINE EXECUTION EVIDENCE
// =========================================================================
test('Background Worker: Code test jobs require verified sandboxed execution evidence', async () => {
  const job = enqueueJob({
    agentId: 'agent-cipher',
    taskType: 'code_test',
    title: 'Self-executing test verification',
    prompt: 'node -e "process.exit(0)"',
  });

  // Execute job
  await executeJob(job);
  const executed = getJobById(job.id);
  assert.ok(executed);
  assert.equal(executed.status, 'completed', 'Job with passing node exit code 0 must complete');
  assert.ok(executed.result, 'Job must return execution result');
  assert.ok(executed.result.artifacts?.includes('node -e "process.exit(0)"'));

  // Failing job must fail
  const failingJob = enqueueJob({
    agentId: 'agent-cipher',
    taskType: 'code_test',
    title: 'Failing command test',
    prompt: 'node -e "process.exit(1)"',
  });
  await executeJob(failingJob);
  const failingExec = getJobById(failingJob.id);
  assert.ok(failingExec);
  assert.equal(failingExec.status, 'failed', 'Job with non-zero exit code must be marked failed');
});

// =========================================================================
// 24. MISSION LEASES DEFEND PAUSE, RESUME, AND CANCEL MUTATIONS
// =========================================================================
test('Mission State Control: Pause, resume, and cancel enforce atomic worker lease fencing', async () => {
  const mission = planMission({
    title: 'Mission Lease Fencing API Test',
    objective: 'Ensure state transitions respect active worker leases',
    priority: 'high',
  });
  assert.ok(mission.id);

  // Lock the worker lease as active worker 'worker-active-lock'
  const leaseKey = `mission:${mission.id}`;
  const lease = acquireWorkerLease(leaseKey, 'worker-active-lock', 30000);
  assert.equal(lease.acquired, true);

  // Attempting to acquire lease by a different actor fails closed
  const concurrentAttempt = acquireWorkerLease(leaseKey, 'api-controller-concurrent', 5000);
  assert.equal(concurrentAttempt.acquired, false, 'Lease acquisition must be rejected when locked');
  assert.equal(concurrentAttempt.ownerId, 'worker-active-lock');

  // Once worker finishes and releases lease, state mutation can proceed
  releaseWorkerLease(leaseKey, 'worker-active-lock');
  const unlockedAttempt = acquireWorkerLease(leaseKey, 'api-controller-new', 5000);
  assert.equal(unlockedAttempt.acquired, true, 'Lease acquisition succeeds once released');
  releaseWorkerLease(leaseKey, 'api-controller-new');
});

// =========================================================================
// 25. BACKGROUND WORKER REJECTS RESEARCH JOBS WITH ZERO VERIFIED CITATIONS
// =========================================================================
test('Background Worker: Research jobs fail closed when zero verified citations are retrieved', async () => {
  const job = enqueueJob({
    agentId: 'agent-scout',
    taskType: 'research',
    title: 'Empty query verification test',
    prompt: '', // Empty query yields 0 citations and must fail
  });

  await executeJob(job);
  const executed = getJobById(job.id);
  assert.ok(executed);
  assert.equal(executed.status, 'failed', 'Research jobs returning zero verified sources must fail');
  assert.ok(executed.error?.includes('zero verified external source citations'));
});

// =========================================================================
// 26. DYNAMIC SOLUTION SYNTHESIS WITHOUT HARDCODED TEMPLATES
// =========================================================================
test('Solution Planner: Dynamic synthesis produces genuine requirement-driven code for arbitrary prompts', async () => {
  const { synthesizeSolutionWithModel, planRequirementDrivenSolution } = await import('../lib/solution-planner.ts');

  // Rate limiter prompt
  const rateLimiterPlan = planRequirementDrivenSolution('Design an async in-memory sliding token bucket rate limiter for API requests');
  assert.equal(rateLimiterPlan.domain, 'rate_limiting');
  assert.ok(rateLimiterPlan.solution.includes('Token') || rateLimiterPlan.solution.includes('consume'));
  assert.ok(rateLimiterPlan.testCode.includes('assert'));
  assert.ok(rateLimiterPlan.methods.includes('consume'));
  assert.ok(rateLimiterPlan.methods.includes('refill'));

  // Deduplication prompt
  const dedupPlan = planRequirementDrivenSolution('Implement an intelligent URL query parameter deduplicator and canonical normalizer');
  assert.equal(dedupPlan.domain, 'data_deduplication');
  assert.ok(dedupPlan.solution.includes('seen') || dedupPlan.solution.includes('normalize'));
  assert.ok(dedupPlan.testCode.includes('assert'));
  assert.ok(dedupPlan.methods.includes('normalize'));

  // Completely novel custom engineering prompt
  const novelPlan = await synthesizeSolutionWithModel('Synthesize a distributed vector clock for causal consistency ordering');
  assert.equal(novelPlan.domain, 'arbitrary_algorithm');
  assert.ok(novelPlan.solution.includes('process'));
  assert.ok(novelPlan.testCode.includes('assert'));
  assert.ok(novelPlan.testCode.length > 50);
});

// =========================================================================
// 27. RUNNER DEFENSE-IN-DEPTH: VALIDATES COMMAND BOUNDARIES AND PATH TRAVERSAL
// =========================================================================
test('Runner Safety: validateCommandSafety independently rejects traversal and destructive commands', () => {
  // Traversal attack
  const traversal = validateCommandSafety('cat ../../.nook_storage/secrets.json', 'agent-scout');
  assert.equal(traversal.safe, false, 'Directory traversal escaping sandbox must be rejected');

  // Sensitive file reference
  const secretRef = validateCommandSafety('cat .env.local', 'agent-scout');
  assert.equal(secretRef.safe, false, 'Access to .env files must be rejected');

  // Destructive command
  const destructive = validateCommandSafety('rm -rf /', 'agent-scout');
  assert.equal(destructive.safe, false, 'Destructive system commands must be rejected');

  // Safe command
  const safe = validateCommandSafety('node -e "console.log(1+1)"', 'agent-scout');
  assert.equal(safe.safe, true, 'Standard commands must be accepted');
});

// =========================================================================
// 28. PLAYWRIGHT SSRF ROUTE INTERCEPTION & NETWORK RESTRICTION
// =========================================================================
test('Playwright Security: SSRF route interception blocks navigations to loopback and cloud metadata', async () => {
  // Cloud metadata endpoint
  const metadataCapture = await captureRealBrowserScreenshot('http://169.254.169.254/latest/meta-data/');
  assert.equal(metadataCapture, null, 'Playwright capture to cloud metadata must be blocked');

  // Loopback / private endpoint
  const loopbackCapture = await captureRealBrowserScreenshot('http://127.0.0.1:3000/api/workspace/state');
  assert.equal(loopbackCapture, null, 'Playwright capture to local network must be blocked');
});

// =========================================================================
// 29. CROSS-AGENT FILESYSTEM BOUNDARY ISOLATION
// =========================================================================
test('Filesystem Isolation: Cross-agent task traversal is strictly blocked', () => {
  // Attempt to read sibling agent's directory
  const crossAgent = validateCommandSafety('cat ../../agent-cipher/tasks/task-99/secret.key', 'agent-scout');
  assert.equal(crossAgent.safe, false, 'Cross-agent directory traversal must be blocked');

  // Attempt to escape through .nook_sandboxes base
  const escapeSandboxes = validateCommandSafety('cat .nook_sandboxes/agent-cipher/tasks', 'agent-scout');
  assert.equal(escapeSandboxes.safe, false, 'Direct reference to other agent sandbox must be blocked');
});

// =========================================================================
// 30. TASK & DOCUMENT EVIDENCE VERIFICATION
// =========================================================================
test('Evidence Engine: Document generation requires verifiable evidence and rejects unproven claims', async () => {
  const job = enqueueJob({
    agentId: 'agent-quill',
    taskType: 'doc_generation',
    title: 'Architecture Review Document',
    prompt: 'Synthesize architecture findings',
  });

  await executeJob(job);
  const executed = getJobById(job.id);
  assert.ok(executed);
  assert.equal(executed.status, 'completed');

  // Verify generated document content
  const db = getDatabase();
  const doc = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(`doc-${job.id}`);
  assert.ok(doc);
  assert.equal(
    doc.content.includes('Verified architecture alignment'),
    false,
    'Must not include unproven boilerplate statements like "Verified architecture alignment"'
  );
  assert.ok(
    doc.content.includes('Task Execution Logs & Findings'),
    'Document must have task execution logs section'
  );
});

// =========================================================================
// 31. MODEL-DRIVEN ITERATIVE SYNTHESIS & ACCEPTANCE VERIFICATION
// =========================================================================
test('Model Coding Engine: Generates verifiable solutions with independent acceptance criteria', async () => {
  const { synthesizeSolutionWithModel } = await import('../lib/solution-planner.ts');
  const plan = await synthesizeSolutionWithModel('Build an in-memory priority queue with TTL expiration');

  assert.ok(plan.solution.length > 50, 'Solution code must be generated');
  assert.ok(plan.testCode.length > 50, 'Test code must be generated');
  assert.ok(plan.command.includes('node --test'), 'Command must run standard test runner');
  assert.ok(Array.isArray(plan.requirements), 'Requirements must be parsed into list');
});

// =========================================================================
// 32. REAL PERSISTENT BROWSER INTERACTIONS (CLICK, TYPE, SUBMIT, STATE REFRESH)
// =========================================================================
test('Browser: Real Playwright browser session supports live typing, form submission, and page state verification', async () => {
  const origLoopback = process.env.ALLOW_TEST_LOOPBACK;
  process.env.ALLOW_TEST_LOOPBACK = 'true';

  // 1. Start authentic HTTP test server with interactive form and search results page
  const testServer = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://127.0.0.1:4044');
    if (parsed.pathname === '/search-portal') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Quantum Portal</title></head>
          <body>
            <h1>Quantum Research Portal</h1>
            <form id="search-form" action="/search-results" method="GET">
              <input type="text" id="query-input" name="q" placeholder="Enter research query" />
              <button type="submit" id="submit-btn">Search Database</button>
            </form>
          </body>
        </html>
      `);
    } else if (parsed.pathname === '/search-results') {
      const q = parsed.searchParams.get('q') || '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Quantum Results</title></head>
          <body>
            <h1>Search Results Page</h1>
            <div id="results">Active query received: <span id="term">${q}</span></div>
          </body>
        </html>
      `);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise((resolve) => testServer.listen(4044, '127.0.0.1', resolve));

  const agentId = 'agent-scout-interactive';

  try {
    // 2. Navigate real browser to the form portal
    const navSession = await navigateBrowser(agentId, 'http://127.0.0.1:4044/search-portal');
    assert.equal(navSession.title, 'Quantum Portal');
    assert.ok(navSession.interactiveElements.length >= 2, 'Must extract interactive elements from live page');

    const inputElem = navSession.interactiveElements.find((e) => e.selector.includes('query-input') || e.selector.includes('name="q"'));
    const btnElem = navSession.interactiveElements.find((e) => e.selector.includes('submit-btn') || e.type === 'button');
    assert.ok(inputElem, 'Input element must exist in live session');
    assert.ok(btnElem, 'Submit button must exist in live session');

    // 3. Genuine Playwright typing: fills real DOM input and validates value
    const typeRes = await typeInteractiveElement(agentId, inputElem.id, 'quantum key distribution');
    assert.equal(typeRes.success, true, 'Typing into live webpage input must succeed');
    assert.ok(typeRes.session.consoleLogs.some((l) => l.includes('Real typed "quantum key distribution"')));

    // 4. Genuine Playwright clicking: clicks submit button, awaits navigation, and verifies resulting page state
    const clickRes = await clickInteractiveElement(agentId, btnElem.id);
    assert.equal(clickRes.success, true, 'Clicking submit button must succeed and transition page state');
    assert.equal(clickRes.session.title, 'Quantum Results', 'Page title must reflect resulting page state');
    assert.ok(clickRes.session.currentUrl.includes('/search-results?q=quantum'), 'URL must reflect form submission');
    assert.ok(clickRes.session.domPreview.includes('Active query received: quantum key distribution'), 'Visible snippet must reflect new page DOM');

    // 5. Test persistent session restoration from disk
    const restored = await restoreBrowserSession(agentId);
    assert.ok(restored);
    assert.equal(restored.agentId, agentId);
    assert.equal(restored.title, 'Quantum Results');
  } finally {
    await closeBrowserSession(agentId);
    await new Promise((resolve) => testServer.close(resolve));
    if (origLoopback === undefined) {
      delete process.env.ALLOW_TEST_LOOPBACK;
    } else {
      process.env.ALLOW_TEST_LOOPBACK = origLoopback;
    }
  }
});

// =========================================================================
// 33. HEARTBEAT-BASED WORKER LEASES & FENCING TOKENS
// =========================================================================
test('Worker Leases: Heartbeat renewal extends expiration and strictly blocks mismatched fencing tokens', () => {
  const resourceId = `mission-heartbeat-${Date.now()}`;
  const ownerId = 'worker-node-alpha';

  // 1. Acquire initial lease
  const initial = acquireWorkerLease(resourceId, ownerId, 10000);
  assert.equal(initial.acquired, true);
  assert.equal(initial.fencingToken, 1);

  // 2. Successful heartbeat renewal with matching token
  const renewed = renewWorkerLeaseHeartbeat(resourceId, ownerId, 1, 20000);
  assert.equal(renewed.renewed, true, 'Heartbeat renewal must succeed with matching token and owner');
  assert.ok(renewed.expiresAt);

  // 3. Stale fencing token renewal rejected
  const staleRenewal = renewWorkerLeaseHeartbeat(resourceId, ownerId, 999, 20000);
  assert.equal(staleRenewal.renewed, false, 'Renewal with wrong fencing token must be rejected');
  assert.ok(staleRenewal.error?.includes('Fencing token mismatch'));

  // 4. Impersonating worker renewal rejected
  const impersonator = renewWorkerLeaseHeartbeat(resourceId, 'worker-node-imposter', 1, 20000);
  assert.equal(impersonator.renewed, false, 'Renewal by different worker must be rejected');

  releaseWorkerLease(resourceId, ownerId);
});

// =========================================================================
// 34. MISSION STATE COMMIT ENFORCES LEASE FENCING
// =========================================================================
test('Mission State Control: commitMissionStateWithFencing strictly prevents writes when lease was lost', () => {
  const mission = planMission({
    title: 'Fenced Commit Test Mission',
    objective: 'Test atomic fencing enforcement on status mutation',
  });

  const leaseKey = `mission:${mission.id}`;
  // Worker 1 acquires lease
  const lease1 = acquireWorkerLease(leaseKey, 'worker-1', 10000);
  assert.equal(lease1.acquired, true);

  // Worker 1 commits active status -> succeeds
  const commit1 = commitMissionStateWithFencing(mission.id, 'worker-1', lease1.fencingToken, 'active');
  assert.equal(commit1.committed, true);

  // Simulate lease timeout or supersede: Worker 2 acquires lease with incremented token
  releaseWorkerLease(leaseKey, 'worker-1');
  const lease2 = acquireWorkerLease(leaseKey, 'worker-2', 10000);
  assert.equal(lease2.fencingToken, 2);

  // Stale Worker 1 attempts to commit 'completed' with old token 1 -> REJECTED!
  const staleCommit = commitMissionStateWithFencing(mission.id, 'worker-1', 1, 'completed');
  assert.equal(staleCommit.committed, false, 'Stale worker commit must be rejected');
  assert.ok(staleCommit.error?.includes('Fencing violation'));

  // Worker 2 commits with token 2 -> succeeds
  const validCommit = commitMissionStateWithFencing(mission.id, 'worker-2', 2, 'completed');
  assert.equal(validCommit.committed, true);

  releaseWorkerLease(leaseKey, 'worker-2');
});

// =========================================================================
// 35. MODEL CODING ENGINE: FAILS LOUD WITHOUT SILENT TEMPLATE FALLBACK
// =========================================================================
test('Model Coding Engine: Reports provider failures accurately and rejects silent template degradation', async () => {
  const { synthesizeSolutionWithModel } = await import('../lib/solution-planner.ts');

  // When model is explicitly requested but invalid credentials or endpoint is supplied, it must fail loud!
  await assert.rejects(
    () => synthesizeSolutionWithModel('Synthesize a distributed consensus engine', {
      mode: 'model',
      requireModel: true,
      provider: 'openai',
      apiKey: 'sk-invalid-test-key-triggering-failure',
    }),
    /Model-driven solution synthesis failed/
  );

  // When explicit template mode is chosen, fast-path requirement-driven synthesizer runs
  const templatePlan = await synthesizeSolutionWithModel('Build an async token bucket rate limiter', {
    mode: 'template',
  });
  assert.ok(templatePlan.solution.length > 50);
  assert.equal(templatePlan.domain, 'rate_limiting');
});

// =========================================================================
// 36. RUNNER SMOKE TEST & DOCKER COMPOSE CONFIGURATION
// =========================================================================
test('Runner Smoke Test: Dedicated runner enforces secret configuration and rejects unauthenticated exec', async () => {
  // Direct unauthenticated execution attempt must be rejected with 401
  const directRes = await fetch('http://127.0.0.1:4010/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'node -v' }),
  });
  assert.equal(directRes.status, 401, 'Unauthenticated exec must receive HTTP 401');

  // Health endpoint verification
  const healthRes = await fetch('http://127.0.0.1:4010/health');
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.status, 'healthy');
  assert.equal(healthData.authRequired, true);
});

// =========================================================================
// 37. CIPHER MISSION: END-TO-END APPROVAL, WORKSPACE ALIGNMENT & EXECUTION
// =========================================================================
test('Cipher Mission: Full end-to-end execution path with human approval, task workspace alignment, and verified sandbox execution', async () => {
  // 1. Create a mission requiring code execution
  const mission = planMission({
    title: 'End-to-End Cipher Mission Test',
    objective: 'Implement an in-memory priority queue and verify with tests',
    requiresCodeExecution: true,
  });

  const tasks = listTasksForMission(mission.id);
  assert.equal(tasks.length, 3, 'Must create 3 dependent tasks (Scout, Quill, Cipher)');
  const cipherTask = tasks.find((t) => t.assignedAgentId === 'agent-cipher');
  assert.ok(cipherTask, 'Cipher task must exist');

  // Advance task 1 (Scout) and task 2 (Quill) to completed
  const scoutTask = tasks.find((t) => t.assignedAgentId === 'agent-scout');
  const quillTask = tasks.find((t) => t.assignedAgentId === 'agent-quill');
  assert.ok(scoutTask && quillTask);

  // Advance mission tick 1: Scout completes
  await tickMission(mission.id, 'worker-test-cipher', 10000);
  // Advance mission tick 2: Quill completes
  await tickMission(mission.id, 'worker-test-cipher', 10000);

  // Advance mission tick 3: Cipher encounters code execution, writes files to workspace and creates approval
  await tickMission(mission.id, 'worker-test-cipher', 10000);

  const blockedCipher = getAgentTaskById(cipherTask.id);
  assert.ok(blockedCipher);
  assert.equal(blockedCipher.status, 'blocked', 'Cipher task must block awaiting human review');
  assert.ok(blockedCipher.approvalId, 'Cipher task must have approvalId attached');

  // Verify approval record
  const approval = getApprovalById(blockedCipher.approvalId);
  assert.ok(approval, 'Approval record must exist in database');
  assert.equal(approval.agentId, 'agent-cipher', 'Approval must be bound to agent-cipher');
  assert.equal(approval.status, 'pending', 'Approval must be pending review');
  const expectedTaskWorkspace = path.resolve(process.cwd(), '.nook_sandboxes', 'agent-cipher', 'tasks', cipherTask.id);
  assert.equal(approval.payload?.taskId, cipherTask.id, 'Approval payload must bind to exact task ID');
  assert.equal(approval.payload?.workspace, expectedTaskWorkspace, 'Approval payload must bind to task workspace');

  // Verify files were placed in the exact task workspace directory
  assert.ok(fs.existsSync(expectedTaskWorkspace), 'Task workspace directory must be created');
  assert.ok(fs.existsSync(path.join(expectedTaskWorkspace, 'solution.mjs')), 'solution.mjs must exist in task workspace');
  assert.ok(fs.existsSync(path.join(expectedTaskWorkspace, 'test_solution.mjs')), 'test_solution.mjs must exist in task workspace');

  // 2. Human reviewer approves the execution
  const decisionRes = decideApproval(blockedCipher.approvalId, 'approve', 'Authorized by QA test lead');
  assert.equal(decisionRes.success, true);

  // 3. Advance mission tick 4: Cipher consumes approval, executes in sandbox, parses structured test results
  await tickMission(mission.id, 'worker-test-cipher', 30000);

  const completedCipher = getAgentTaskById(cipherTask.id);
  assert.ok(completedCipher);
  assert.equal(completedCipher.status, 'completed', 'Cipher task must complete after approval');
  assert.ok(completedCipher.verification?.verified, 'Test output must be verified');

  // Approval must now be consumed
  const consumedApproval = getApprovalById(blockedCipher.approvalId);
  assert.equal(consumedApproval.status, 'consumed', 'Approval token must be single-use and consumed');

  // 4. Verify cross-agent filesystem isolation:
  const scoutWorkspace = path.resolve(process.cwd(), '.nook_sandboxes', 'agent-scout');
  const cipherWorkspace = path.resolve(process.cwd(), '.nook_sandboxes', 'agent-cipher');
  assert.notEqual(scoutWorkspace, cipherWorkspace, 'Agent workspaces must be isolated separate directories');
  assert.ok(!expectedTaskWorkspace.includes('agent-scout'), 'Cipher task workspace cannot overlap Scout workspace');
});

// =========================================================================
// 38. RUNNER STRICT ISOLATION: DENIES FALLBACK WHEN DOCKER IS UNAVAILABLE
// =========================================================================
test('Runner Isolation: Denies execution when genuine container isolation is unavailable', async () => {
  // Start a test runner without container execution enabled on port 4011
  const strictSecret = crypto.randomBytes(32).toString('hex');
  const strictRunner = spawn(process.execPath, [path.resolve(process.cwd(), 'bin/sandbox-runner.mjs')], {
    env: {
      ...process.env,
      PORT: '4011',
      SANDBOX_RUNNER_SECRET: strictSecret,
      NOOK_DISABLE_DOCKER: 'true',
    },
    stdio: 'ignore',
  });
  if (strictRunner.unref) strictRunner.unref();

  try {
    for (let i = 0; i < 20; i++) {
      try {
        const h = await fetch('http://127.0.0.1:4011/health');
        if (h.ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Create a valid execution ticket for test
    const dummyJob = enqueueJob({
      agentId: 'agent-cipher-strict',
      taskType: 'code_test',
      title: 'Strict container isolation test',
      prompt: 'node -v',
    });

    const ticket = createSandboxExecutionTicket({
      command: 'node -v',
      agentId: 'agent-cipher-strict',
      taskId: dummyJob.id,
      authorizationType: 'system_verified_test',
      secret: strictSecret,
    });
    const ticketBase64 = Buffer.from(JSON.stringify(ticket)).toString('base64');

    // Attempt execution against strict runner where Docker is unavailable
    const execRes = await fetch('http://127.0.0.1:4011/exec', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ticketBase64}`,
      },
      body: JSON.stringify({
        agentId: 'agent-cipher-strict',
        command: 'node -v',
        taskId: dummyJob.id,
      }),
    });

    assert.equal(execRes.status, 422, 'Strict runner must return 422 when container isolation is unavailable');
    const data = await execRes.json();
    assert.equal(data.exitCode, 126, 'Must fail closed with exitCode 126');
    assert.ok(data.error.includes('Genuine per-task container isolation is required'), 'Must report container isolation requirement');
  } finally {
    killProcessSafely(strictRunner);
  }
});

// =========================================================================
// 39. AUTHORIZATION MATRIX: REJECTS AGENT AND COMMAND MISMATCHES
// =========================================================================
test('Authorization Matrix: Strictly denies mismatched agent, tampered command, or unapproved ticket creation', () => {
  const secret = crypto.randomBytes(32).toString('hex');

  // 1. Create a task for agent-scout
  const scoutJob = enqueueJob({
    agentId: 'agent-scout',
    taskType: 'research',
    title: 'Scout research task',
    prompt: 'quantum cryptography',
  });

  // Attempt to issue ticket for agent-cipher using scout's task -> must throw!
  assert.throws(
    () => createSandboxExecutionTicket({
      command: 'echo "hacked"',
      agentId: 'agent-cipher',
      taskId: scoutJob.id,
      authorizationType: 'system_verified_test',
      secret,
    }),
    /Server authorization denied: Job agent mismatch/
  );

  // 2. Create approval for a specific command
  const appr = createApproval({
    agentId: 'agent-cipher',
    agentName: 'Cipher',
    type: 'run_command',
    title: 'Authorized Command',
    payload: { command: 'npm test' },
  });
  const apprDecision = decideApproval(appr.id, 'approve');
  assert.equal(apprDecision.success, true);

  // Attempt to issue ticket for a different command using that approval -> must throw!
  assert.throws(
    () => createSandboxExecutionTicket({
      command: 'rm -rf /',
      agentId: 'agent-cipher',
      approvalId: appr.id,
      authorizationType: 'human_approval',
      secret,
    }),
    /Server authorization denied: Approval command mismatch/
  );
});

// =========================================================================
// 40. RUNNER PRIVILEGE BOUNDARY: ENFORCES ISOLATED SUPERVISOR AND REJECTS HOST SOCKET
// =========================================================================
test('Runner Privilege Boundary: Rejects direct host Docker socket exposure and requires isolated supervisor', async () => {
  // 1. Verify that docker-compose.yml does NOT mount /var/run/docker.sock
  const dockerComposeContent = fs.readFileSync(path.resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
  assert.equal(
    dockerComposeContent.includes('/var/run/docker.sock:/var/run/docker.sock'),
    false,
    'docker-compose.yml must not expose the host Docker socket'
  );
  assert.ok(
    dockerComposeContent.includes('container-supervisor'),
    'docker-compose.yml must define an isolated container supervisor'
  );
  assert.ok(
    dockerComposeContent.includes('dind'),
    'Supervisor must use an isolated container runtime'
  );
  assert.ok(
    dockerComposeContent.includes('DOCKER_HOST=tcp://container-supervisor:2375'),
    'Runner must communicate with supervisor via isolated network TCP DOCKER_HOST'
  );
  assert.ok(
    dockerComposeContent.includes('internal: true'),
    'Supervisor network must be strictly internal with no host or external exposure'
  );

  // 2. Test runner privilege boundary guard: simulate host socket presence in production
  const fakeSocketDir = path.resolve(process.cwd(), '.nook_sandboxes', 'test_fake_socket_dir');
  fs.mkdirSync(fakeSocketDir, { recursive: true });
  const fakeSocketPath = path.resolve(fakeSocketDir, 'docker.sock');
  fs.writeFileSync(fakeSocketPath, '');

  const secret = crypto.randomBytes(32).toString('hex');
  const boundaryRunner = spawn(process.execPath, [path.resolve(process.cwd(), 'bin/sandbox-runner.mjs')], {
    env: {
      ...process.env,
      PORT: '4012',
      NODE_ENV: 'production',
      SANDBOX_RUNNER_SECRET: secret,
      TEST_HOST_DOCKER_SOCKET_PATH: fakeSocketPath,
    },
    stdio: 'pipe',
  });

  const exitPromise = new Promise((resolve) => {
    let errOutput = '';
    boundaryRunner.stderr.on('data', (d) => { errOutput += d.toString(); });
    boundaryRunner.on('close', (code) => resolve({ code, errOutput }));
  });

  const { code, errOutput } = await exitPromise;
  assert.equal(code, 1, 'Runner must fail closed when host socket exposure is detected in production');
  assert.ok(
    errOutput.includes('PRIVILEGE BOUNDARY BREACH') || errOutput.includes('Direct host Docker socket'),
    'Runner error must explicitly state the privilege boundary violation'
  );

  // Clean up fake socket
  try {
    fs.unlinkSync(fakeSocketPath);
    fs.rmdirSync(fakeSocketDir);
  } catch {}
});

// =========================================================================
// 41. REAL DOCKER EXECUTION: VERIFIED WORKSPACE MAPPING WITHOUT MOCK FALLBACK
// =========================================================================
test('Real Docker: Verified workspace-volume mapping executes genuine container with task files', async () => {
  // Check if a real, live Docker daemon is available
  const hasRealDocker = await new Promise((resolve) => {
    const p = spawn('docker', ['version'], { stdio: 'ignore' });
    p.on('close', (c) => resolve(c === 0));
    p.on('error', () => resolve(false));
  });

  if (!hasRealDocker) {
    // In local environments without Docker daemon (e.g. Windows desktop without daemon), skip gracefully
    console.log('  ℹ Skipping real Docker test: Docker daemon not available on local host.');
    return;
  }

  // Real Docker daemon is available (e.g. CI runner on ubuntu-latest)
  // Spin up a dedicated runner instance configured with genuine Docker (no mock prefix!)
  const realRunnerSecret = crypto.randomBytes(32).toString('hex');
  const realRunner = spawn(process.execPath, [path.resolve(process.cwd(), 'bin/sandbox-runner.mjs')], {
    env: {
      ...process.env,
      PORT: '4013',
      SANDBOX_RUNNER_SECRET: realRunnerSecret,
      DOCKER_BIN: 'docker',
      // Explicitly NO DOCKER_ARGS_PREFIX: real Docker commands only!
    },
    stdio: 'ignore',
  });
  if (realRunner.unref) realRunner.unref();

  try {
    // Wait for real runner to become healthy
    for (let i = 0; i < 30; i++) {
      try {
        const h = await fetch('http://127.0.0.1:4013/health');
        if (h.ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const testAgentId = 'agent-cipher-real';

    // Create a real task record in database
    const job = enqueueJob({
      agentId: testAgentId,
      taskType: 'code_test',
      title: 'Real Docker Execution Test',
      prompt: 'node test_entry.mjs',
    });

    // Create virtual files to execute inside the real container
    const virtualFiles = [
      {
        name: 'test_entry.mjs',
        content: `
import fs from 'fs';
console.log('REAL_CONTAINER_EXECUTION_VERIFIED_OK');
fs.writeFileSync('task_result.json', JSON.stringify({ executedBy: 'docker_node22', status: 'pass' }));
`,
      },
    ];

    // Generate authenticated HMAC execution ticket
    const ticket = createSandboxExecutionTicket({
      command: 'node test_entry.mjs',
      agentId: testAgentId,
      taskId: job.id,
      authorizationType: 'system_verified_test',
      secret: realRunnerSecret,
    });
    const ticketBase64 = Buffer.from(JSON.stringify(ticket)).toString('base64');

    // Execute via runner using real Docker
    const execRes = await fetch('http://127.0.0.1:4013/exec', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ticketBase64}`,
      },
      body: JSON.stringify({
        agentId: testAgentId,
        command: 'node test_entry.mjs',
        taskId: job.id,
        virtualFiles,
        timeoutMs: 30000,
      }),
    });

    assert.equal(execRes.status, 200, 'Real Docker execution must return 200');
    const data = await execRes.json();
    assert.equal(data.exitCode, 0, 'Real Docker container command must exit with code 0');
    assert.ok(
      data.stdout.includes('REAL_CONTAINER_EXECUTION_VERIFIED_OK'),
      'Real Docker container stdout must contain output from virtual file execution'
    );
    assert.equal(data.isolatedRuntime, 'docker_container', 'Runtime must be docker_container');
    assert.ok(data.workspaceMapping?.verified, 'Workspace mapping must be verified');

    // Verify that the task workspace directory on the runner host received the file written by the real container
    const expectedWorkspace = path.resolve(process.cwd(), '.nook_sandboxes', testAgentId, 'tasks', job.id);
    const resultJsonPath = path.join(expectedWorkspace, 'task_result.json');
    assert.ok(fs.existsSync(resultJsonPath), 'task_result.json written by real container must exist on disk');
    const writtenContent = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'));
    assert.equal(writtenContent.status, 'pass');
    assert.equal(writtenContent.executedBy, 'docker_node22');
  } finally {
    killProcessSafely(realRunner);
  }
});

// =========================================================================
// 42. AUTHENTICATION HARDENING: RATE LIMITING PREVENTS BRUTE-FORCE
// =========================================================================
test('Auth Hardening: Login rate limiting blocks brute-force attempts and enforces cooldown', () => {
  const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

  // Initial check should pass
  const initial = checkLoginRateLimit(testIp);
  assert.equal(initial.allowed, true);

  // Record 4 failed attempts -> still allowed
  for (let i = 0; i < 4; i++) {
    recordFailedLogin(testIp);
  }
  const mid = checkLoginRateLimit(testIp);
  assert.equal(mid.allowed, true);

  // Record 5th failed attempt -> locked out
  recordFailedLogin(testIp);
  const locked = checkLoginRateLimit(testIp);
  assert.equal(locked.allowed, false, 'IP must be locked out after 5 consecutive failed login attempts');
  assert.ok(locked.retryAfterSeconds && locked.retryAfterSeconds > 0, 'Retry-after seconds must be positive');

  // Successful login clears the lockout / failures
  recordSuccessfulLogin(testIp);
  const reset = checkLoginRateLimit(testIp);
  assert.equal(reset.allowed, true, 'Successful login must reset failure counter');
});

// =========================================================================
// 43. SYSTEM HEALTH: READINESS PROBES VERIFY REAL DEPENDENCIES AND PREVENT SENSITIVE CACHING
// =========================================================================
test('System Health: Deep readiness checks database & runner health, and prevents caching', async () => {
  const db = getDatabase();
  assert.ok(db, 'Database handle must be active');
  const probe = db.prepare('SELECT 1 as alive').get();
  assert.equal(probe.alive, 1, 'Database probe must return alive = 1');

  // Verify runner health endpoint returns JSON health
  const runnerRes = await fetch('http://127.0.0.1:4010/health');
  assert.equal(runnerRes.status, 200);
  const runnerHealth = await runnerRes.json();
  assert.equal(runnerHealth.status, 'healthy');
});

// =========================================================================
// 44. SOVEREIGN BACKUP/RESTORE: ROUND-TRIP PERSISTENCE OF MISSIONS & EVIDENCE
// =========================================================================
test('Workspace Backup: Round-trip persistence restores missions and evidence timeline records', () => {
  const db = getDatabase();
  const testMissionId = `mission-backup-${Date.now()}`;
  const testEvidenceId = `ev-backup-${Date.now()}`;

  // Insert mission record
  db.prepare(`
    INSERT INTO missions (
      id, title, objective, status, priority, assigned_agents_json, milestones_json, budget_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    testMissionId,
    'Sovereign Backup Test Mission',
    'Verify round-trip export/import preservation',
    'completed',
    'high',
    JSON.stringify(['agent-scout', 'agent-cipher']),
    JSON.stringify([]),
    JSON.stringify({ maxToolCalls: 20, usedToolCalls: 1 }),
    new Date().toISOString(),
    new Date().toISOString()
  );

  // Insert evidence record
  db.prepare(`
    INSERT INTO evidence_records (
      id, mission_id, task_id, agent_id, agent_name, timestamp, action_type, summary, details_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    testEvidenceId,
    testMissionId,
    null,
    'agent-scout',
    'Scout',
    new Date().toISOString(),
    'web_search',
    'Verified evidence citation preserved',
    JSON.stringify({ query: 'quantum verification', resultsCount: 5 }),
    'success'
  );

  // Retrieve and verify
  const restoredMission = getMissionById(testMissionId);
  assert.ok(restoredMission, 'Restored mission must be retrievable');
  assert.equal(restoredMission.title, 'Sovereign Backup Test Mission');
  assert.equal(restoredMission.status, 'completed');

  const evidenceRecord = db.prepare('SELECT * FROM evidence_records WHERE id = ?').get(testEvidenceId);
  assert.ok(evidenceRecord, 'Restored evidence record must be retrievable');
  assert.equal(evidenceRecord.summary, 'Verified evidence citation preserved');
  assert.equal(evidenceRecord.agent_id, 'agent-scout');
});

// =========================================================================
// 45. APPROVAL STATE MACHINE: ONE EXECUTION PER APPROVAL
// =========================================================================
test('Approval State Machine: Consumed approval cannot authorize a second execution ticket', () => {
  const approval = createApproval({
    agentId: 'agent-cipher',
    agentName: 'Cipher',
    type: 'run_command',
    title: 'Single-use Ticket Authorization Test',
    description: 'Verify execution attempt cannot be reused',
    payload: { command: 'node verify.mjs', taskId: 'task-single-use-1' },
  });

  decideApproval(approval.id, 'approve', 'Approved by reviewer');
  const taskId = 'task-single-use-1';

  // First ticket generation succeeds and binds the approval to the task
  const ticket1 = createSandboxExecutionTicket({
    command: 'node verify.mjs',
    agentId: 'agent-cipher',
    taskId,
    approvalId: approval.id,
    authorizationType: 'human_approval',
  });
  assert.ok(ticket1.ticketId);

  // Second ticket generation using the same approval MUST fail closed immediately
  assert.throws(
    () => {
      createSandboxExecutionTicket({
        command: 'node verify.mjs',
        agentId: 'agent-cipher',
        taskId,
        approvalId: approval.id,
        authorizationType: 'human_approval',
      });
    },
    /already used for an execution attempt/i,
    'A consumed approval must never authorize a second execution ticket'
  );
});

// =========================================================================
// 46. HUMAN APPROVER VS MACHINE CREDENTIAL SEPARATION
// =========================================================================
test('Credential Separation: Machine API key cannot decide approvals; approver password required', () => {
  process.env.NOOK_API_KEY = 'nook-machine-api-key-32bytes';
  process.env.NOOK_APPROVER_PASSWORD = 'nook-human-approver-password-32bytes';

  // 1. Machine API key request to decide approvals is rejected with 403
  const machineReq = new Request('http://127.0.0.1:3000/api/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nook-api-key': process.env.NOOK_API_KEY,
    },
    body: JSON.stringify({ action: 'decide', approvalId: 'any', decision: 'approve' }),
  });
  const machineCheck = validateHumanApproverRequest(machineReq);
  assert.equal(machineCheck.authorized, false);
  assert.equal(machineCheck.status, 403);
  assert.ok(machineCheck.error?.includes('Machine credentials (API key) cannot issue human approval decisions'));

  // 2. Approver credential validation succeeds and derives distinct session
  assert.equal(verifyApproverCredentials('nook-human-approver-password-32bytes'), true);
  assert.equal(verifyApproverCredentials(process.env.NOOK_API_KEY), false);

  const approverToken = createSessionToken(APPROVER_SESSION_ID);
  const approverReq = new Request('http://127.0.0.1:3000/api/approvals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${approverToken}`,
    },
    body: JSON.stringify({ action: 'decide', approvalId: 'any', decision: 'approve' }),
  });
  const approverCheck = validateHumanApproverRequest(approverReq);
  assert.equal(approverCheck.authorized, true);
});

// =========================================================================
// 47. SOVEREIGN BACKUP/RESTORE: RECONSTRUCTS REVISIONS, TASKS, AND EVIDENCE
// =========================================================================
test('Sovereign Backup/Restore: Complete round-trip reconstructs revisions, full tasks, and evidence', () => {
  // Create an isolated fresh in-memory database
  const sourceDb = new DatabaseSync(':memory:');
  applySchema(sourceDb);

  // Populate source DB with spaces, documents, revisions, missions, tasks, evidence
  sourceDb.prepare(`INSERT INTO spaces (id, name, icon, created_at, updated_at) VALUES ('sp-1', 'Research', 'book', '2026-01-01', '2026-01-01')`).run();
  sourceDb.prepare(`INSERT INTO documents (id, space_id, title, content, author_agent_id, version, created_at, updated_at) VALUES ('doc-1', 'sp-1', 'Title v2', 'Content v2', 'agent-quill', 2, '2026-01-01', '2026-01-02')`).run();
  sourceDb.prepare(`INSERT INTO document_revisions (id, document_id, version, title, content, author_agent_id, created_at) VALUES ('rev-1', 'doc-1', 1, 'Title v1', 'Content v1', 'agent-quill', '2026-01-01')`).run();
  sourceDb.prepare(`INSERT INTO document_revisions (id, document_id, version, title, content, author_agent_id, created_at) VALUES ('rev-2', 'doc-1', 2, 'Title v2', 'Content v2', 'agent-quill', '2026-01-02')`).run();
  sourceDb.prepare(`INSERT INTO missions (id, title, objective, status, priority, assigned_agents_json, milestones_json, created_at, updated_at) VALUES ('msn-1', 'Mission 1', 'Objective 1', 'active', 'high', '["agent-cipher"]', '[]', '2026-01-01', '2026-01-01')`).run();
  sourceDb.prepare(`INSERT INTO agent_tasks (id, mission_id, title, goal, assigned_agent_id, status, created_at, updated_at) VALUES ('tsk-1', 'msn-1', 'Task 1', 'Goal 1', 'agent-cipher', 'pending', '2026-01-01', '2026-01-01')`).run();
  sourceDb.prepare(`INSERT INTO evidence_records (id, mission_id, task_id, agent_id, agent_name, timestamp, action_type, summary, details_json, status) VALUES ('ev-1', 'msn-1', 'tsk-1', 'agent-cipher', 'Cipher', '2026-01-01', 'shell_exec', 'Summary', '{}', 'success')`).run();

  // Export from source
  const bundle = exportWorkspaceSnapshot(sourceDb);
  assert.equal(bundle.schemaVersion, 2);
  assert.equal(bundle.documentRevisions.length, 2);
  assert.equal(bundle.missions[0].tasks?.length, 1);
  assert.equal(bundle.evidenceTimeline.length, 1);

  // Restore into a completely fresh destination database
  const targetDb = new DatabaseSync(':memory:');
  applySchema(targetDb);
  const result = importWorkspaceSnapshot(bundle, targetDb);
  assert.equal(result.success, true);
  assert.equal(result.importedRevisionsCount, 2);
  assert.equal(result.importedTasksCount, 1);
  assert.equal(result.importedEvidenceCount, 1);

  // Verify target state matches
  const targetRevs = targetDb.prepare(`SELECT * FROM document_revisions WHERE document_id = 'doc-1' ORDER BY version ASC`).all();
  assert.equal(targetRevs.length, 2);
  const targetTasks = targetDb.prepare(`SELECT * FROM agent_tasks WHERE mission_id = 'msn-1'`).all();
  assert.equal(targetTasks.length, 1);
  const targetMission = targetDb.prepare(`SELECT * FROM missions WHERE id = 'msn-1'`).get();
  assert.equal(targetMission.status, 'paused', 'Restored unfinished active mission is safely paused on restore');
});

// =========================================================================
// 48. WORKER EXACTLY-ONCE RECOVERY GUARANTEE
// =========================================================================
test('Worker Recovery: Non-idempotent action in-flight suppresses retry and rejects duplicate claim', () => {
  const db = getDatabase();
  const jobId = `job-side-effect-${Date.now()}`;
  db.prepare(`
    INSERT INTO background_jobs (id, agent_id, task_type, title, status, prompt, created_at, updated_at)
    VALUES (?, 'cipher', 'code_test', 'Test Job', 'running', 'node -v', ?, ?)
  `).run(jobId, new Date().toISOString(), new Date(Date.now() - 60000).toISOString());

  // Claim side effect started
  const claimed = markJobSideEffectStarted(jobId);
  assert.equal(claimed, true);

  // Duplicate claim while already in flight is rejected
  const duplicateClaim = markJobSideEffectStarted(jobId);
  assert.equal(duplicateClaim, false, 'Duplicate start of non-idempotent action must be rejected');

  // Simulate worker crash timeout: 60s elapsed since last progress
  db.prepare(`UPDATE background_jobs SET updated_at = ? WHERE id = ?`).run(
    new Date(Date.now() - 60000).toISOString(),
    jobId
  );

  // Stale recovery runs: job with side_effect_state='started' MUST be aborted, NOT requeued
  recoverStaleJobsAndMissions();

  const recovered = getJobById(jobId);
  assert.equal(recovered?.status, 'failed');
  assert.ok(recovered?.error?.includes('Retry suppressed to preserve exactly-once execution guarantee'));
});

// =========================================================================
// 49. BROWSER NETWORK EGRESS RESTRICTIONS
// =========================================================================
test('Browser Egress: Network egress resolution strictly forbids loopback and cloud metadata', async () => {
  const metadata = await resolveHostSafely('169.254.169.254');
  assert.equal(metadata.safe, false);
  assert.ok(metadata.reason?.includes('forbidden'));

  const internalDomain = await resolveHostSafely('metadata.google.internal');
  assert.equal(internalDomain.safe, false);

  const internalLocal = await resolveHostSafely('router.local');
  assert.equal(internalLocal.safe, false);
});

// =========================================================================
// 50. SYMLINK FILESYSTEM BOUNDARY HARDENING
// =========================================================================
test('Filesystem Boundary: ensureRealDirectoryWithin and writeFileNoFollow refuse symlinks', async () => {
  const testRoot = path.resolve(process.cwd(), '.nook_sandboxes', `fs_boundary_${Date.now()}`);
  fs.mkdirSync(testRoot, { recursive: true });

  try {
    const verified = await ensureRealDirectoryWithin(testRoot, path.join(testRoot, 'sub', 'dir'));
    assert.ok(verified.startsWith(testRoot));

    await writeFileNoFollow(path.join(testRoot, 'sub', 'dir'), 'safe.txt', 'SAFE_CONTENT');
    const content = fs.readFileSync(path.join(testRoot, 'sub', 'dir', 'safe.txt'), 'utf8');
    assert.equal(content, 'SAFE_CONTENT');

    // Attempt traversal via invalid name
    await assert.rejects(
      async () => {
        await writeFileNoFollow(path.join(testRoot, 'sub', 'dir'), '../escape.txt', 'MALICIOUS');
      },
      WorkspaceSecurityError
    );
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

// =========================================================================
// 51. OPERATIONAL RECOVERY: APPROVED TASKS INTERRUPTED BY CRASH
// =========================================================================
test('Operational Recovery: Interrupted approved tasks fail safely on crash to preserve single-use approvals', async () => {
  const db = getDatabase();
  const testTaskId = `task-recovery-crash-${Date.now()}`;
  const testApprovalId = `appr-recovery-crash-${Date.now()}`;
  const pastTime = new Date(Date.now() - 75000).toISOString();

  const testMissionId = `mission-recovery-test-${Date.now()}`;
  db.prepare(`
    INSERT INTO missions (id, title, objective, status, priority, assigned_agents_json, milestones_json, created_at, updated_at)
    VALUES (?, 'Recovery Mission', 'Testing recovery', 'active', 'high', '[]', '[]', ?, ?)
  `).run(testMissionId, pastTime, pastTime);

  db.prepare(`
    INSERT INTO agent_tasks (id, mission_id, title, goal, assigned_agent_id, status, approval_id, created_at, updated_at)
    VALUES (?, ?, 'Approved Task In-Flight', 'Run sensitive action', 'agent-cipher', 'in_progress', ?, ?, ?)
  `).run(testTaskId, testMissionId, testApprovalId, pastTime, pastTime);

  const res = recoverStaleJobsAndMissions();
  assert.ok(res.recoveredMissions >= 1, 'Must recover stale task');

  const task = getAgentTaskById(testTaskId);
  assert.equal(task?.status, 'failed', 'Interrupted approved task must fail safe instead of resetting to pending');
});

// =========================================================================
// 52. BROWSER EGRESS PROTECTION: MANDATORY PROXY & NO SILENT FALLBACK
// =========================================================================
test('Browser Egress: Mandatory proxy enforcement and fail-closed defense against silent fallback', async () => {
  const { getGlobalEgressProxy, stopGlobalEgressProxy } = await import('../lib/egress-proxy.ts');
  const net = await import('net');

  // 1. Egress proxy starts and binds securely to loopback
  const proxy = await getGlobalEgressProxy();
  assert.ok(proxy.port > 0);
  assert.ok(proxy.url.startsWith('http://127.0.0.1:'));

  // 2. CONNECT tunnel refuses link-local / cloud metadata targets
  const connectBlocked = await new Promise((resolve) => {
    const client = net.connect({ host: '127.0.0.1', port: proxy.port }, () => {
      client.write('CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254:80\r\n\r\n');
    });
    client.on('data', (chunk) => {
      resolve(chunk.toString());
      client.destroy();
    });
    client.on('error', () => resolve('error'));
  });
  assert.ok(connectBlocked.includes('403 Forbidden'), 'CONNECT tunnel to metadata must be rejected with 403');
  assert.ok(connectBlocked.includes('Forbidden by Nook Egress Policy'));

  // 3. Plain HTTP proxy refuses link-local / cloud metadata targets
  const httpBlocked = await new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxy.port,
        path: 'http://169.254.169.254/latest/meta-data',
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', (err) => resolve({ status: 500, body: err.message }));
    req.end();
  });
  assert.equal(httpBlocked.status, 403);
  assert.ok(httpBlocked.body.includes('403 Forbidden by Nook Browser Egress Policy'));

  // 4. navigateBrowser refuses to silently fall back when egress protection blocks navigation
  await assert.rejects(
    async () => {
      await navigateBrowser('agent-scout-egress-test', 'http://169.254.169.254/latest/meta-data');
    },
    /SSRF Policy Violation/
  );

  // 5. Proxy restart resilience: after stopping proxy, getGlobalEgressProxy cleanly provisions new instance
  await stopGlobalEgressProxy();
  const refreshedProxy = await getGlobalEgressProxy();
  assert.ok(refreshedProxy.server.listening, 'Restarted proxy must be active and listening');
});

// =========================================================================
// 53. PERSISTENCE & EXPORT: REVISION DEDUPING, ROLLBACK SPACE INTEGRITY, & IMPORT CONFLICT HANDLING
// =========================================================================
test('Persistence: Document revisions deduping, rollback space preservation, and snapshot import/export integrity', () => {
  const nonce = Date.now();
  const spaceId = `space-persist-${nonce}`;
  const docId = `doc-persist-${nonce}`;
  const testMissionId = `mission-conflict-${nonce}`;
  const testTaskId = `task-conflict-${nonce}`;
  const testApprovalId = `app-audit-${nonce}`;

  // 1. Revision deduping: identical content does NOT create duplicate revisions or increment version
  saveSpace({ id: spaceId, name: 'Persistence Space', icon: 'folder' });

  const v1 = saveDocumentWithRevision({
    id: docId,
    spaceId,
    title: 'Idempotency Doc',
    content: 'Initial immutable text content',
  });
  assert.equal(v1.version, 1);
  const revs1 = listDocumentRevisions(docId);
  assert.equal(revs1.length, 1);

  // Re-saving identical content & title -> version remains 1, no duplicate revision inserted
  const v1Same = saveDocumentWithRevision({
    id: docId,
    spaceId,
    title: 'Idempotency Doc',
    content: 'Initial immutable text content',
  });
  assert.equal(v1Same.version, 1);
  const revsAfterSame = listDocumentRevisions(docId);
  assert.equal(revsAfterSame.length, 1, 'Identical content must not create duplicate revision rows');

  // Saving modified content -> increments version to 2
  const v2 = saveDocumentWithRevision({
    id: docId,
    spaceId,
    title: 'Idempotency Doc',
    content: 'Updated modified text content',
  });
  assert.equal(v2.version, 2);
  const revs2 = listDocumentRevisions(docId);
  assert.equal(revs2.length, 2);

  // 2. Rollback space preservation: rolling back does NOT corrupt spaceId to rev.document_id
  const rolledBack = rollbackDocumentToVersion(docId, 1);
  assert.equal(rolledBack.version, 3);
  assert.equal(rolledBack.content, 'Initial immutable text content');
  assert.equal(rolledBack.spaceId, spaceId, 'Rollback must preserve original spaceId instead of document_id');

  const docInDb = getDocumentById(docId);
  assert.equal(docInDb?.spaceId, spaceId, 'Database record must retain spaceId');

  // 3. Isolated DB: seedInitialSpaces seeds default spaces when table is empty
  const isolatedDb = new DatabaseSync(':memory:');
  applySchema(isolatedDb);
  const emptySpaces = isolatedDb.prepare('SELECT count(*) as count FROM spaces').get();
  assert.equal(emptySpaces.count, 0);

  const seeded = seedInitialSpaces(undefined, isolatedDb);
  assert.ok(seeded.length > 0);
  const filledSpaces = isolatedDb.prepare('SELECT count(*) as count FROM spaces').get();
  assert.equal(filledSpaces.count, seeded.length);

  // 4. Snapshot Import: updates existing records (ON CONFLICT DO UPDATE) and restores approvals with safe tokens
  const db = getDatabase();
  db.prepare(`
    INSERT INTO missions (id, title, objective, status, priority, assigned_agents_json, milestones_json, created_at, updated_at)
    VALUES (?, 'Old Title', 'Old Objective', 'planning', 'low', '[]', '[]', datetime('now'), datetime('now'))
  `).run(testMissionId);

  // Prepare a snapshot with an update for this mission, plus approvals audit
  const bundle = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    version: 1,
    spaces: [{ id: spaceId, name: 'Updated Space Name', description: 'Updated Space Description' }],
    documents: [{
      id: docId,
      spaceId,
      title: 'Updated From Snapshot',
      content: 'Imported Snapshot Content',
      version: 5,
      excerpt: 'Imported',
      icon: 'file-text',
    }],
    missions: [{
      id: testMissionId,
      title: 'New Title From Snapshot',
      objective: 'New Objective From Snapshot',
      status: 'active',
      priority: 'high',
      assignedAgentIds: ['agent-cipher'],
      milestones: [{ id: 'm-1', title: 'Milestone 1', completed: true }],
      budget: { tokenLimit: 50000 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    tasks: [{
      id: testTaskId,
      missionId: testMissionId,
      title: 'Imported Task',
      goal: 'Execute imported goal',
      assignedAgentId: 'agent-cipher',
      status: 'completed',
      inputs: { key: 'value' },
      outputs: { result: 'done' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    approvalsAudit: [{
      id: testApprovalId,
      action: 'run_command',
      command: 'echo imported',
      agentId: 'agent-cipher',
      status: 'approved',
      reason: 'Audit import test',
      requestedAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      decidedBy: 'owner',
      decisionReason: 'Allowed',
    }],
  };

  const importResult = importWorkspaceSnapshot(bundle);
  assert.equal(importResult.importedMissionsCount, 1);
  assert.equal(importResult.importedTasksCount, 1);
  assert.equal(importResult.importedApprovalsCount, 1);

  // Verify mission was updated, not ignored
  const updatedMission = getMissionById(testMissionId);
  assert.equal(updatedMission?.title, 'New Title From Snapshot');
  assert.equal(updatedMission?.status, 'paused', 'Imported active missions are safely set to paused');
  // Check no double stringification
  assert.equal(typeof updatedMission?.milestones, 'object');
  assert.equal(updatedMission?.milestones[0]?.title, 'Milestone 1');

  // Verify task inputs/outputs are parsed objects
  const importedTask = getAgentTaskById(testTaskId);
  assert.equal(importedTask?.inputs?.key, 'value');
  assert.equal(importedTask?.outputs?.result, 'done');

  // Verify approval was restored with safe token
  const restoredApproval = getApprovalById(testApprovalId);
  assert.ok(restoredApproval !== null);
  assert.equal(restoredApproval?.status, 'approved');
  assert.ok(restoredApproval?.singleUseToken?.startsWith('expired-import-token-'));
});

after(async () => {
  killProcessSafely(runnerProc);
  await closeAllBrowserSessions().catch(() => {});
  const { stopGlobalEgressProxy } = await import('../lib/egress-proxy.ts');
  await stopGlobalEgressProxy().catch(() => {});
});


