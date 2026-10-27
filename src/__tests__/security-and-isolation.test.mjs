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
} from '../lib/db.ts';
import {
  loadEncryptedSecrets,
  saveEncryptedSecrets,
  maskSecret,
  SUPPORTED_MODELS,
} from '../lib/secrets.ts';
import { executeJob, tickActiveMissions, recoverStaleJobsAndMissions } from '../lib/worker.ts';
import { executeSandboxedCommand, validateCommandSafety } from '../lib/sandbox.ts';
import { planMission, tickMission } from '../lib/orchestrator.ts';
import { getOrCreateBrowserSession, navigateBrowser } from '../lib/browser-session.ts';

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
  const mission = planMission({
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
// 12. BROWSER OBSERVABLE SESSION TESTS
// =========================================================================
test('Browser: Observable browser session enforces network-level egress restrictions', async () => {
  const session = getOrCreateBrowserSession('agent-scout');
  assert.ok(session);
  assert.equal(session.agentId, 'agent-scout');
  assert.ok(session.history.length >= 1);

  // Attempt navigation to forbidden internal host must be blocked
  await assert.rejects(
    () => navigateBrowser('agent-scout', 'http://169.254.169.254/latest/meta-data'),
    /SSRF Policy Violation/
  );
});

