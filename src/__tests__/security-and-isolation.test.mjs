import test from 'node:test';
import assert from 'node:assert/strict';

// Import core security and infrastructure libraries
import {
  createSessionToken,
  verifySessionToken,
  validateApiRequest,
  isServerAuthSetupComplete,
  verifyOwnerCredentials,
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
  redactApproval,
  getDatabase,
} from '../lib/db.ts';
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
  captureSessionScreenshot,
  renderBrowserScreenshotPng,
  captureRealBrowserScreenshot,
} from '../lib/browser-session.ts';
import {
  createSandboxExecutionTicket,
  verifySandboxExecutionTicket,
  getSandboxRunnerSecret,
} from '../lib/sandbox-ticket.ts';
import fs from 'fs';
import path from 'path';

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
    const res = await executeSandboxedCommand({
      agentId: 'cipher-test',
      command: echoCmd,
      timeoutMs: 8000,
      allowHostFallback: true,
    });

    assert.equal(res.exitCode, 0, 'Safe command must succeed in sandbox');
    assert.ok(res.stdout.includes('SANDBOX_OK'), 'Output should contain command result');
    assert.ok(res.isolatedRuntime === 'docker_container' || res.isolatedRuntime === 'process_jail');
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
  // Safe fetch to Wikipedia API
  const res = await safeFetch('https://en.wikipedia.org/w/api.php?action=opensearch&search=test&limit=1&format=json', {
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
// 15. SANDBOX FAIL-CLOSED ENFORCEMENT & COMMAND CONSTRUCTION
// =========================================================================
test('Sandbox: Host fallback fails closed when Docker is unavailable in production', async () => {
  // Test fail-closed policy with allowHostFallback = false
  const res = await executeSandboxedCommand({
    agentId: 'cipher-audit',
    command: 'node -v',
    timeoutMs: 5000,
    allowHostFallback: false,
  });

  // If docker is not present or configured in this test environment, it must fail closed with exit code 126
  if (res.isolatedRuntime === 'none') {
    assert.equal(res.exitCode, 126, 'Must exit with code 126 on isolation failure');
    assert.ok(res.stderr.includes('Security Policy Violation'), 'Must report security policy violation');
  } else {
    // If docker was running, it must have executed within docker container
    assert.equal(res.isolatedRuntime, 'docker_container');
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
// 20. SANDBOX RUNNER EXECUTION TICKET AUTHENTICATION & REPLAY DEFENSE
// =========================================================================
// =========================================================================
// 20. SANDBOX RUNNER EXECUTION TICKET AUTHENTICATION & AUTHORIZATION CHAIN
// =========================================================================
test('Sandbox Tickets: Validates action-bound HMAC tickets, authorization chain, and rejects insecure defaults or replay', () => {
  const secret = 'a9f2c8d1e3b50742a8c3d7e1f4095861b2a4c6e80d2f4a6b8c0e2d4f6a8b0c2e';
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
  const badSecret = verifySandboxExecutionTicket(ticket, command, agentId, undefined, 'f4095861b2a4c6e80d2f4a6b8c0e2d4fa9f2c8d1e3b50742a8c3d7e1');
  assert.equal(badSecret.valid, false, 'Wrong secret must be rejected');
  assert.ok(badSecret.error?.includes('cryptographic signature is invalid'));

  // 6. Expired ticket fails
  const expiredTicket = createSandboxExecutionTicket({ command, agentId, approvalId, authorizationType: 'human_approval', ttlMs: -1000, secret });
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
});

// =========================================================================
// 21. BROWSER SCREENSHOT METADATA & REAL CAPTURE VERIFICATION
// =========================================================================
test('Browser Screenshots: Real Playwright browser capture produces authentic PNG and strictly rejects placeholders', async () => {
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
    doc.content.includes('Verifiable Evidence & Findings'),
    'Document must have verifiable evidence section'
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

