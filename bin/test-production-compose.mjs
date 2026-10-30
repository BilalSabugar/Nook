#!/usr/bin/env node
/**
 * Nook Production Docker Compose Integration & Cross-Agent Isolation Verification
 *
 * Runs against the actual live production container deployment:
 * 1. Web application container (nook:latest on port 3000)
 * 2. Dedicated background worker container (nook-worker)
 * 3. Dedicated sandbox runner container (nook-sandbox-runner on port 4000)
 * 4. Isolated container execution supervisor (nook-container-supervisor)
 *
 * Verifies:
 * - Real container health & readiness across all tiers
 * - Privilege boundary enforcement (no host socket exposure)
 * - Authentic HMAC ticket validation & action binding
 * - Genuine containerized task execution via isolated DinD supervisor
 * - Cross-agent filesystem isolation (agent cannot escape workspace or access another agent's tasks)
 * - Task workspace persistence and artifact extraction
 */

import crypto from 'crypto';
import assert from 'assert/strict';

const RUNNER_URL = process.env.SANDBOX_SERVICE_URL || 'http://127.0.0.1:4000';
const WEB_URL = process.env.WEB_SERVICE_URL || 'http://127.0.0.1:3000';
const SECRET = process.env.SANDBOX_RUNNER_SECRET;

if (!SECRET) {
  console.error('[FAIL] SANDBOX_RUNNER_SECRET environment variable is required');
  process.exit(1);
}

function computeCommandHash(cmd) {
  return crypto.createHash('sha256').update(cmd.trim()).digest('hex');
}

const NOOK_API_KEY = process.env.NOOK_API_KEY || 'nook-production-test-api-key-32bytes';
const NOOK_APPROVER_PASSWORD = process.env.NOOK_APPROVER_PASSWORD || '';

function createSignedTicket({
  command,
  agentId,
  taskId,
  approvalId = null,
  authorizationType = 'system_verified_test',
  ttlMs = 30000,
}) {
  const ticketId = `ticket-prod-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const now = Date.now();
  const issuedAt = now;
  const expiresAt = now + ttlMs;
  const commandHash = computeCommandHash(command);
  const safeTaskId = (taskId || 'task-default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const workspacePath = `/workspace/${agentId}/tasks/${safeTaskId}`;

  const payload = `${ticketId}:${commandHash}:${agentId}:${taskId}:${workspacePath}:${approvalId || 'none'}:${authorizationType}:${issuedAt}:${expiresAt}:sandboxed_exec`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');

  return {
    ticketId,
    agentId,
    commandHash,
    taskId,
    workspacePath,
    approvalId,
    authorizationType,
    issuedAt,
    expiresAt,
    action: 'sandboxed_exec',
    signature,
  };
}

async function runnerExec({ agentId, command, taskId, virtualFiles = [], approvalId = null, authorizationType = 'system_verified_test' }) {
  const ticket = createSignedTicket({ command, agentId, taskId, approvalId, authorizationType });
  const res = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Buffer.from(JSON.stringify(ticket)).toString('base64')}`,
    },
    body: JSON.stringify({ agentId, command, taskId, virtualFiles, timeoutMs: 15000 }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function humanApproverLogin() {
  assert.ok(NOOK_APPROVER_PASSWORD.length >= 12, 'NOOK_APPROVER_PASSWORD must be provided to the E2E suite');
  const res = await fetch(`${WEB_URL}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: NOOK_APPROVER_PASSWORD }),
  });
  assert.equal(res.status, 200, `Approver login must succeed, got ${res.status}`);
  const cookies = res.headers.getSetCookie();
  const session = cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('nook_session='));
  assert.ok(session, 'Approver login must establish a session cookie');
  return session;
}

async function waitForHealthy(url, name, maxWaitMs = 60000) {
  const start = Date.now();
  process.stdout.write(`Waiting for ${name} (${url}) to become healthy... `);
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        if (body.status === 'healthy' || body.status === 'ok') {
          console.log(`[READY] (${Date.now() - start}ms)`);
          return body;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timeout waiting for ${name} at ${url} after ${maxWaitMs}ms`);
}

async function run() {
  console.log('=================================================================');
  console.log('Nook Production Docker Compose Integration & Security Verification');
  console.log('=================================================================\n');

  // Step 1: Verify health of all services
  const runnerHealth = await waitForHealthy(`${RUNNER_URL}/health`, 'Sandbox Runner');
  assert.equal(runnerHealth.status, 'healthy');
  assert.equal(runnerHealth.runner, 'dedicated_sandbox_runner');
  assert.equal(runnerHealth.supervisor, 'isolated_dind_supervisor');
  assert.equal(runnerHealth.privilegeBoundary, 'enforced');
  console.log('✔ Sandbox Runner: Healthy with isolated DinD supervisor & privilege boundary enforced');

  const webHealth = await waitForHealthy(`${WEB_URL}/api/health`, 'Web Application');
  assert.ok(webHealth.status === 'healthy' || webHealth.status === 'ok', 'Web application status should be healthy or ok');
  console.log('✔ Web Application: Healthy and responsive\n');

  // Step 2: Verify Cross-Agent Filesystem Isolation
  console.log('Testing Cross-Agent Filesystem Isolation...');

  // Attempt 1: Agent Cipher tries to access Agent Scout's directory via path traversal in command
  const traversalCommand = 'cat ../../agent-scout/tasks/default/secret.txt';
  const traversalTicket = createSignedTicket({
    command: traversalCommand,
    agentId: 'agent-cipher',
    taskId: 'task-cipher-traversal-1',
  });
  const traversalTicketB64 = Buffer.from(JSON.stringify(traversalTicket)).toString('base64');

  const traversalRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${traversalTicketB64}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: traversalCommand,
      taskId: 'task-cipher-traversal-1',
    }),
  });

  assert.equal(traversalRes.status, 403, 'Cross-agent directory traversal command must be strictly blocked with HTTP 403');
  const traversalBody = await traversalRes.json();
  assert.ok(
    traversalBody.error?.includes('Cross-agent') || traversalBody.error?.includes('Security violation'),
    'Error must explain cross-agent isolation violation'
  );
  console.log('✔ Pre-execution boundary: Cross-agent traversal command rejected with HTTP 403');

  // Attempt 2: Agent Cipher tries to reference .nook_storage or absolute cross-agent path
  const storageCommand = 'cat /app/.nook_storage/encryption.salt';
  const storageTicket = createSignedTicket({
    command: storageCommand,
    agentId: 'agent-cipher',
    taskId: 'task-cipher-storage-1',
  });
  const storageTicketB64 = Buffer.from(JSON.stringify(storageTicket)).toString('base64');

  const storageRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${storageTicketB64}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: storageCommand,
      taskId: 'task-cipher-storage-1',
    }),
  });

  assert.equal(storageRes.status, 403, 'Access to .nook_storage must be blocked with HTTP 403');
  console.log('✔ Pre-execution boundary: Protected storage access rejected with HTTP 403\n');

  // Step 3: Verify Genuine Sandbox Execution in Real Production Container
  console.log('Testing Production Sandboxed Execution & Workspace Mapping...');
  const cipherTaskId = `cipher-prod-test-${Date.now()}`;
  const cipherCommand = 'node run_analysis.mjs';

  const virtualFiles = [
    {
      name: 'run_analysis.mjs',
      content: `
import fs from 'fs';
console.log('PROD_COMPOSE_EXECUTION_VERIFIED_SUCCESS');
fs.writeFileSync('output_metrics.json', JSON.stringify({
  agent: 'agent-cipher',
  executionMode: 'isolated_container',
  timestamp: Date.now(),
  passed: true
}));
`,
    },
  ];

  const execTicket = createSignedTicket({
    command: cipherCommand,
    agentId: 'agent-cipher',
    taskId: cipherTaskId,
  });
  const execTicketB64 = Buffer.from(JSON.stringify(execTicket)).toString('base64');

  const execRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${execTicketB64}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: cipherCommand,
      taskId: cipherTaskId,
      virtualFiles,
      timeoutMs: 30000,
    }),
  });

  assert.equal(execRes.status, 200, `Execution should succeed with HTTP 200, got ${execRes.status}`);
  const execData = await execRes.json();
  assert.equal(execData.exitCode, 0, 'Container process should exit with code 0');
  assert.ok(
    execData.stdout.includes('PROD_COMPOSE_EXECUTION_VERIFIED_SUCCESS'),
    'Container stdout must contain expected execution output'
  );
  assert.equal(execData.isolatedRuntime, 'docker_container', 'Runtime must be docker_container');
  assert.ok(execData.workspaceMapping?.verified, 'Workspace volume mapping must be verified');
  console.log('✔ Sandbox Execution: Successfully executed inside isolated container via supervisor');
  console.log(`  Mapping type: ${execData.workspaceMapping.type}`);
  console.log(`  Runtime: ${execData.isolatedRuntime}`);

  // Step 4: Verify in-container filesystem boundary
  // Command running inside container cannot see /app/.nook_storage or host storage directories
  const boundaryCheckCmd = 'node check_boundary.mjs';
  const boundaryFiles = [
    {
      name: 'check_boundary.mjs',
      content: `
import fs from 'fs';
const hasAppStorage = fs.existsSync('/app/.nook_storage');
console.log('CONTAINER_FILESYSTEM_CHECK: SUCCESS');
console.log('APP_STORAGE_ACCESSIBLE: ' + hasAppStorage);
`,
    },
  ];

  const boundaryTicket = createSignedTicket({
    command: boundaryCheckCmd,
    agentId: 'agent-cipher',
    taskId: `cipher-boundary-${Date.now()}`,
  });
  const boundaryTicketB64 = Buffer.from(JSON.stringify(boundaryTicket)).toString('base64');

  const boundaryRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${boundaryTicketB64}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: boundaryCheckCmd,
      taskId: boundaryTicket.taskId,
      virtualFiles: boundaryFiles,
      timeoutMs: 15000,
    }),
  });

  assert.equal(boundaryRes.status, 200, `Boundary execution should return 200, got ${boundaryRes.status}`);
  const boundaryData = await boundaryRes.json();
  assert.equal(boundaryData.exitCode, 0);
  assert.ok(
    boundaryData.stdout.includes('CONTAINER_FILESYSTEM_CHECK: SUCCESS'),
    'Container script should execute successfully'
  );
  assert.ok(
    boundaryData.stdout.includes('APP_STORAGE_ACCESSIBLE: false'),
    'Container filesystem must not expose host or web container storage paths'
  );
  console.log('✔ In-container boundary: Host storage is completely isolated from task container\n');

  // Step 5: Adversarial In-Container Cross-Agent Isolation Proof
  console.log('Testing Adversarial In-Container Cross-Agent Isolation...');
  const scoutTaskId = `scout-canary-${Date.now()}`;
  const scoutCmd = 'node setup_canary.mjs';
  const scoutCanaryToken = `SCOUT_CANARY_SECRET_DATA_${Date.now()}`;
  const scoutFiles = [
    {
      name: 'setup_canary.mjs',
      content: `
import fs from 'fs';
fs.writeFileSync('scout_sentinel.txt', '${scoutCanaryToken}', 'utf8');
console.log('SCOUT_CANARY_STORED');
`,
    },
  ];

  const scoutTicket = createSignedTicket({
    command: scoutCmd,
    agentId: 'agent-scout',
    taskId: scoutTaskId,
  });
  const scoutRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Buffer.from(JSON.stringify(scoutTicket)).toString('base64')}`,
    },
    body: JSON.stringify({
      agentId: 'agent-scout',
      command: scoutCmd,
      taskId: scoutTaskId,
      virtualFiles: scoutFiles,
      timeoutMs: 15000,
    }),
  });
  assert.equal(scoutRes.status, 200);
  const scoutData = await scoutRes.json();
  assert.equal(scoutData.exitCode, 0);
  assert.ok(scoutData.stdout.includes('SCOUT_CANARY_STORED'));
  console.log('✔ Populated Scout workspace with private sentinel canary');

  // Now, Agent Cipher attempts to read Scout's sentinel from inside its task container
  const cipherAdversaryTaskId = `cipher-adversary-${Date.now()}`;
  const cipherAdversaryCmd = 'node adversary_probe.mjs';
  const cipherAdversaryFiles = [
    {
      name: 'adversary_probe.mjs',
      content: `
import fs from 'fs';
import http from 'http';

// 1. Try reading Scout's canary via directory escape
let canaryFound = false;
const paths = [
  '../../agent-scout/tasks/${scoutTaskId}/scout_sentinel.txt',
  '/workspace/agent-scout/tasks/${scoutTaskId}/scout_sentinel.txt',
  '/app/.nook_sandboxes/agent-scout/tasks/${scoutTaskId}/scout_sentinel.txt',
];
for (const p of paths) {
  try {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      if (content.includes('SCOUT_CANARY_SECRET_DATA')) canaryFound = true;
    }
  } catch {}
}

// 2. Try reaching supervisor Docker API. Await the outcome: only a settled ERROR proves unreachability.
const dockerProbe = await new Promise((resolve) => {
  let done = false;
  const finish = (outcome, code) => {
    if (done) return;
    done = true;
    resolve({ settled: true, outcome, code: code || null });
  };
  try {
    const req = http.get('http://container-supervisor:2375/version', { timeout: 3000 }, (res) => {
      res.resume();
      finish('response', res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); finish('error', 'ETIMEDOUT'); });
    req.on('error', (e) => finish('error', e.code || 'ERR'));
  } catch (e) {
    finish('error', e.code || 'THROWN');
  }
  setTimeout(() => finish('error', 'WATCHDOG'), 5000);
});
const dockerControlPlaneReachable = dockerProbe.outcome === 'response';

// 3. Check for leaked host runner secrets
const runnerSecretLeaked = Boolean(process.env.SANDBOX_RUNNER_SECRET);

console.log(JSON.stringify({
  canaryFound,
  dockerControlPlaneReachable,
  dockerProbe,
  runnerSecretLeaked,
  status: 'PROBE_COMPLETE'
}));
`,
    },
  ];

  const cipherAdversaryTicket = createSignedTicket({
    command: cipherAdversaryCmd,
    agentId: 'agent-cipher',
    taskId: cipherAdversaryTaskId,
  });
  const cipherAdvRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Buffer.from(JSON.stringify(cipherAdversaryTicket)).toString('base64')}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: cipherAdversaryCmd,
      taskId: cipherAdversaryTaskId,
      virtualFiles: cipherAdversaryFiles,
      timeoutMs: 15000,
    }),
  });

  assert.equal(cipherAdvRes.status, 200);
  const cipherAdvData = await cipherAdvRes.json();
  assert.equal(cipherAdvData.exitCode, 0);
  const probeMatch = cipherAdvData.stdout.match(/\{"canaryFound":.*\}/);
  assert.ok(probeMatch, 'Adversary probe must produce structured JSON output');
  const probeResult = JSON.parse(probeMatch[0]);

  assert.equal(probeResult.canaryFound, false, 'Adversarial task container MUST NOT be able to read another agent canary');
  assert.equal(probeResult.dockerProbe?.settled, true, 'Docker control-plane probe must have settled (not report before the request finished)');
  assert.equal(probeResult.dockerProbe?.outcome, 'error', 'Docker control-plane probe must end in a network error, never a response');
  assert.equal(probeResult.dockerControlPlaneReachable, false, 'Task container MUST NOT be able to reach supervisor Docker API');
  assert.equal(probeResult.runnerSecretLeaked, false, 'Host secrets MUST NOT be exposed in task container environment');
  console.log('✔ In-container adversarial isolation: Cannot read other agent canary, cannot reach Docker daemon, and has no host secrets\n');

  // Step 5b: Symlink boundary. A task plants a symlink in its persistent workspace that points at
  // another agent's private file; a later run must NOT follow it.
  console.log('Testing Symlink Filesystem-Boundary Regression...');
  const linkTaskId = `cipher-symlink-${Date.now()}`;
  const plantRun = await runnerExec({
    agentId: 'agent-cipher',
    command: 'node plant_link.mjs',
    taskId: linkTaskId,
    virtualFiles: [
      {
        name: 'plant_link.mjs',
        content: `import fs from 'fs';
try { fs.symlinkSync('/app/.nook_sandboxes/agent-scout/tasks/${scoutTaskId}/scout_sentinel.txt', 'link.txt'); } catch {}
console.log('LINK_PLANTED');`,
      },
    ],
  });
  assert.equal(plantRun.status, 200, 'Link planting run must execute');
  const overwriteRun = await runnerExec({
    agentId: 'agent-cipher',
    command: 'node noop.mjs',
    taskId: linkTaskId,
    virtualFiles: [
      { name: 'link.txt', content: 'SYMLINK_OVERWRITE_ATTACK' },
      { name: 'noop.mjs', content: 'console.log("NOOP");' },
    ],
  });
  assert.ok([200, 403].includes(overwriteRun.status), `Overwrite run must be safely handled, got ${overwriteRun.status}`);
  const readBack = await runnerExec({
    agentId: 'agent-scout',
    command: 'node read_canary.mjs',
    taskId: scoutTaskId,
    virtualFiles: [
      {
        name: 'read_canary.mjs',
        content: "import fs from 'fs'; console.log('CANARY=' + fs.readFileSync('scout_sentinel.txt','utf8'));",
      },
    ],
  });
  assert.equal(readBack.status, 200);
  assert.ok(readBack.data.stdout.includes(`CANARY=${scoutCanaryToken}`), 'Scout canary must be intact after symlink attack');
  assert.ok(!readBack.data.stdout.includes('SYMLINK_OVERWRITE_ATTACK'), 'Symlink must not redirect writes into another agent workspace');
  console.log('✔ Symlink boundary: planted link was not followed; other agent file untouched\n');

  // Step 6: Supervisor Network Isolation
  console.log('Testing Supervisor Control Plane Network Isolation...');
  let hostPortReachable = false;
  try {
    const probe = await fetch('http://127.0.0.1:2375/version', { signal: AbortSignal.timeout(1000) });
    if (probe.ok) hostPortReachable = true;
  } catch {
    hostPortReachable = false;
  }
  assert.equal(hostPortReachable, false, 'Supervisor Docker API must NOT be published to host network');
  console.log('✔ Supervisor control plane: Unexposed to host and strictly isolated\n');

  // Step 7: Full Application Human Approval Lifecycle
  console.log('Testing Full Nook Application Human Approval Lifecycle...');
  const apiHeaders = {
    'Content-Type': 'application/json',
    'x-nook-api-key': NOOK_API_KEY,
  };
  const approverSessionCookie = await humanApproverLogin();
  const humanHeaders = {
    'Content-Type': 'application/json',
    Cookie: approverSessionCookie,
    Origin: WEB_URL,
  };

  // 7a. Register approval request on server
  const missionCommand = 'node approved_task.mjs';
  const approvalCreateRes = await fetch(`${WEB_URL}/api/approvals`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({
      action: 'create',
      agentId: 'agent-cipher',
      agentName: 'Cipher (Security Engineer)',
      type: 'run_command',
      title: 'Execute verified security validation script',
      description: 'Human approval decision required',
      payload: {
        command: missionCommand,
        agentId: 'agent-cipher',
      },
    }),
  });
  assert.equal(approvalCreateRes.status, 201, 'Approval creation should return 201');
  const approvalCreateData = await approvalCreateRes.json();
  const testApprovalId = approvalCreateData.approval?.id;
  assert.ok(testApprovalId, 'Approval ID must be returned');
  console.log(`✔ Step 7a: Created pending approval (${testApprovalId})`);

  // 7b. Attempt execution before human decision: verify_and_consume rejected with 403
  const preDecisionVerifyRes = await fetch(`${WEB_URL}/api/approvals`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({
      action: 'verify_and_consume',
      approvalId: testApprovalId,
      token: 'fake-unapproved-token',
      command: missionCommand,
      agentId: 'agent-cipher',
    }),
  });
  assert.equal(preDecisionVerifyRes.status, 403, 'Verify and consume before human decision must be rejected with 403');
  console.log('✔ Step 7b: Execution before human approval decision is strictly rejected (403)');

  // 7c. Machine credential (API key) must NOT be able to decide; the human approver session can
  const machineDecideRes = await fetch(`${WEB_URL}/api/approvals`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({ action: 'decide', approvalId: testApprovalId, decision: 'approve', reason: 'machine attempt' }),
  });
  assert.equal(machineDecideRes.status, 403, 'API key must be refused when deciding approvals');
  console.log('✔ Step 7c-i: Machine credential cannot issue human approval decisions (403)');

  const decideRes = await fetch(`${WEB_URL}/api/approvals`, {
    method: 'POST',
    headers: humanHeaders,
    body: JSON.stringify({
      action: 'decide',
      approvalId: testApprovalId,
      decision: 'approve',
      reason: 'Verified by human reviewer in Compose integration suite',
    }),
  });
  assert.equal(decideRes.status, 200, 'Human decision should succeed with 200');
  console.log('✔ Step 7c: Human approver session approved the request');

  // 7d. Runner authorization matrix: Unapproved tickets and mismatches strictly rejected
  // Missing approvalId on human_approval ticket: rejected with 403
  const missingApprTicket = createSignedTicket({
    command: missionCommand,
    agentId: 'agent-cipher',
    taskId: `cipher-missing-${Date.now()}`,
    approvalId: '',
    authorizationType: 'human_approval',
  });
  const missingApprRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Buffer.from(JSON.stringify(missingApprTicket)).toString('base64')}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: missionCommand,
      taskId: missingApprTicket.taskId,
    }),
  });
  assert.equal(missingApprRes.status, 403, 'Ticket with missing approvalId must be rejected with 403');

  // Command mismatch: rejected with 403
  const mismatchTicket = createSignedTicket({
    command: 'node different_cmd.mjs',
    agentId: 'agent-cipher',
    taskId: `cipher-mismatch-${Date.now()}`,
    approvalId: testApprovalId,
    authorizationType: 'human_approval',
  });
  const mismatchRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Buffer.from(JSON.stringify(mismatchTicket)).toString('base64')}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: missionCommand,
      taskId: mismatchTicket.taskId,
    }),
  });
  assert.equal(mismatchRes.status, 403, 'Ticket with command mismatch must be rejected with 403');
  console.log('✔ Step 7d: Runner authorization matrix strictly enforces approvalId and command binding (403)');

  // 7e. Authorized execution succeeds
  const approvedTaskId = `cipher-approved-${Date.now()}`;
  const approvedTicket = createSignedTicket({
    command: missionCommand,
    agentId: 'agent-cipher',
    taskId: approvedTaskId,
    approvalId: testApprovalId,
    authorizationType: 'human_approval',
  });
  const approvedTicketB64 = Buffer.from(JSON.stringify(approvedTicket)).toString('base64');

  const approvedFiles = [
    {
      name: 'approved_task.mjs',
      content: 'console.log("VERIFIED_CIPHER_HUMAN_APPROVED_MISSION");',
    },
  ];

  const execApprovedRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${approvedTicketB64}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: missionCommand,
      taskId: approvedTaskId,
      virtualFiles: approvedFiles,
      timeoutMs: 15000,
    }),
  });
  assert.equal(execApprovedRes.status, 200, 'Approved execution must succeed');
  const execApprovedData = await execApprovedRes.json();
  assert.equal(execApprovedData.exitCode, 0);
  assert.ok(execApprovedData.stdout.includes('VERIFIED_CIPHER_HUMAN_APPROVED_MISSION'));
  console.log('✔ Step 7e: Bound command executed successfully under human approval');

  // 7f. Replay attack rejection: Using the same ticket again fails with 403
  const replayRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${approvedTicketB64}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: missionCommand,
      taskId: approvedTaskId,
    }),
  });
  assert.equal(replayRes.status, 403, 'Replayed ticket execution must fail with 403');
  console.log('✔ Step 7f: Replayed execution ticket strictly rejected (403)');

  // 7g. A FRESH ticket (new id) for the SAME approval must be rejected: approvals are single-use
  const secondTicketRun = await runnerExec({
    agentId: 'agent-cipher',
    command: missionCommand,
    taskId: `cipher-second-attempt-${Date.now()}`,
    approvalId: testApprovalId,
    authorizationType: 'human_approval',
    virtualFiles: approvedFiles,
  });
  assert.equal(secondTicketRun.status, 403, 'A second ticket for an already used approval must be rejected');
  console.log('✔ Step 7g: Single-use approval cannot authorize a second execution (403)\n');

  // Step 8: Sovereign Workspace Round-Trip Export/Import
  console.log('Testing Sovereign Workspace Round-Trip Export and Import...');
  const exportRes = await fetch(`${WEB_URL}/api/workspace/export`, {
    headers: apiHeaders,
  });
  assert.equal(exportRes.status, 200, 'Workspace export must succeed with 200');
  const bundle = await exportRes.json();
  assert.equal(bundle.schemaVersion, 2, 'Schema version must be 2');
  assert.ok(Array.isArray(bundle.spaces), 'Export bundle must contain spaces array');
  assert.ok(Array.isArray(bundle.missions), 'Export bundle must contain missions array');
  assert.ok(Array.isArray(bundle.evidenceTimeline), 'Export bundle must contain evidenceTimeline array');
  console.log(`✔ Step 8a: Exported workspace bundle with ${bundle.spaces.length} spaces, ${bundle.missions.length} missions`);

  const importRes = await fetch(`${WEB_URL}/api/workspace/import`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify(bundle),
  });
  assert.equal(importRes.status, 200, 'Workspace import must succeed with 200');
  const importData = await importRes.json();
  assert.equal(importData.success, true);
  console.log(`✔ Step 8b: Restored workspace (${importData.importedSpacesCount || 0} spaces, ${importData.importedDocsCount || 0} docs, ${importData.importedMissionsCount || 0} missions, ${importData.importedEvidenceCount || 0} evidence logs)\n`);

  console.log('=================================================================');
  console.log('ALL PRODUCTION DOCKER COMPOSE INTEGRATION TESTS PASSED (100%)');
  console.log('=================================================================');
}

run().catch((err) => {
  console.error('\n[FATAL INTEGRATION ERROR]:', err);
  process.exit(1);
});
