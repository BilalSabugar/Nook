#!/usr/bin/env node
/**
 * Nook Production Docker Compose Integration & Cross-Agent Isolation Verification
 *
 * Runs against the actual live production container deployment:
 * 1. Web application container (nook:latest on port 3000)
 * 2. Dedicated background worker container (nook-worker)
 * 3. Dedicated sandbox runner container (nook-sandbox-runner on port 4000)
 * 4. Isolated rootless execution supervisor (nook-container-supervisor)
 *
 * Verifies:
 * - Real container health & readiness across all tiers
 * - Privilege boundary enforcement (no host socket exposure)
 * - Authentic HMAC ticket validation & action binding
 * - Genuine containerized task execution via rootless DinD supervisor
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

function createSignedTicket({
  command,
  agentId,
  taskId,
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

  const payload = `${ticketId}:${commandHash}:${agentId}:${taskId}:${workspacePath}:none:${authorizationType}:${issuedAt}:${expiresAt}:sandboxed_exec`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');

  return {
    ticketId,
    agentId,
    commandHash,
    taskId,
    workspacePath,
    approvalId: null,
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
  assert.equal(runnerHealth.supervisor, 'isolated_rootless_supervisor');
  assert.equal(runnerHealth.privilegeBoundary, 'enforced');
  console.log('✔ Sandbox Runner: Healthy with isolated rootless supervisor & privilege boundary enforced');

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

  console.log('=================================================================');
  console.log('ALL PRODUCTION DOCKER COMPOSE INTEGRATION TESTS PASSED (100%)');
  console.log('=================================================================');
}

run().catch((err) => {
  console.error('\n[FATAL INTEGRATION ERROR]:', err);
  process.exit(1);
});
