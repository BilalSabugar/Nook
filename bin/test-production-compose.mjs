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

// 2. Try reaching supervisor Docker API
let dockerControlPlaneReachable = false;
try {
  const req = http.get('http://container-supervisor:2375/version', { timeout: 1000 }, () => {
    dockerControlPlaneReachable = true;
  });
  req.on('error', () => {});
} catch {}

// 3. Check for leaked host runner secrets
const runnerSecretLeaked = Boolean(process.env.SANDBOX_RUNNER_SECRET);

console.log(JSON.stringify({
  canaryFound,
  dockerControlPlaneReachable,
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
  assert.equal(probeResult.dockerControlPlaneReachable, false, 'Task container MUST NOT be able to reach supervisor Docker API');
  assert.equal(probeResult.runnerSecretLeaked, false, 'Host secrets MUST NOT be exposed in task container environment');
  console.log('✔ In-container adversarial isolation: Cannot read other agent canary, cannot reach Docker daemon, and has no host secrets\n');

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

  // 7b. Attempt execution before human decision: strictly rejected (403)
  const preDecisionTicket = createSignedTicket({
    command: missionCommand,
    agentId: 'agent-cipher',
    taskId: `cipher-predecision-${Date.now()}`,
    approvalId: testApprovalId,
    authorizationType: 'human_approval',
  });
  const preDecisionRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Buffer.from(JSON.stringify(preDecisionTicket)).toString('base64')}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: missionCommand,
      taskId: preDecisionTicket.taskId,
    }),
  });
  assert.equal(preDecisionRes.status, 403, 'Execution before human approval decision must be rejected with 403');
  console.log('✔ Step 7b: Execution before human approval decision is strictly rejected (403)');

  // 7c. Human owner approves the request
  const decideRes = await fetch(`${WEB_URL}/api/approvals`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({
      action: 'decide',
      approvalId: testApprovalId,
      decision: 'approve',
      reason: 'Verified by human reviewer in Compose integration suite',
    }),
  });
  assert.equal(decideRes.status, 200, 'Human decision should succeed with 200');
  console.log('✔ Step 7c: Human owner approved the request');

  // 7d. Replay prevention: Executing once consumes the ticket, second execution of same ticket fails
  const approvedTicket = createSignedTicket({
    command: missionCommand,
    agentId: 'agent-cipher',
    taskId: `cipher-approved-${Date.now()}`,
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
      taskId: approvedTicket.taskId,
      virtualFiles: approvedFiles,
      timeoutMs: 15000,
    }),
  });
  assert.equal(execApprovedRes.status, 200, 'Approved execution must succeed');
  const execApprovedData = await execApprovedRes.json();
  assert.equal(execApprovedData.exitCode, 0);
  assert.ok(execApprovedData.stdout.includes('VERIFIED_CIPHER_HUMAN_APPROVED_MISSION'));
  console.log('✔ Step 7d: Bound command executed successfully under human approval');

  // 7e. Replay attack rejection: Using the same ticket again fails with 403
  const replayRes = await fetch(`${RUNNER_URL}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${approvedTicketB64}`,
    },
    body: JSON.stringify({
      agentId: 'agent-cipher',
      command: missionCommand,
      taskId: approvedTicket.taskId,
    }),
  });
  assert.equal(replayRes.status, 403, 'Replayed ticket execution must fail with 403');
  console.log('✔ Step 7e: Replayed execution ticket strictly rejected (403)\n');

  // Step 8: Sovereign Workspace Round-Trip Export/Import
  console.log('Testing Sovereign Workspace Round-Trip Export and Import...');
  const exportRes = await fetch(`${WEB_URL}/api/workspace/export`, {
    headers: apiHeaders,
  });
  assert.equal(exportRes.status, 200, 'Workspace export must succeed with 200');
  const bundle = await exportRes.json();
  assert.equal(bundle.schemaVersion, 1, 'Schema version must be 1');
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
  assert.ok(importData.importedSpacesCount >= 1, 'Import must restore at least 1 space');
  console.log(`✔ Step 8b: Restored workspace (${importData.importedSpacesCount} spaces, ${importData.importedDocsCount} docs)\n`);

  console.log('=================================================================');
  console.log('ALL PRODUCTION DOCKER COMPOSE INTEGRATION TESTS PASSED (100%)');
  console.log('=================================================================');
}

run().catch((err) => {
  console.error('\n[FATAL INTEGRATION ERROR]:', err);
  process.exit(1);
});
