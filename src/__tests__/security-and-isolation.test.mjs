import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';

// Import core security and infrastructure libraries
import {
  createSessionToken,
  verifySessionToken,
  validateApiRequest,
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
import { executeJob } from '../lib/worker.ts';

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

test('Auth: Legitimate cryptographic session tokens succeed', () => {
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
