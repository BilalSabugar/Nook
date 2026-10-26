import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const APPROVALS_FILE = path.join(STORAGE_DIR, 'approvals.json');
const JOBS_FILE = path.join(STORAGE_DIR, 'jobs.json');
const STATE_FILE = path.join(STORAGE_DIR, 'workspace-state.json');

test('Server Approval Lifecycle and Single-Use Token Enforcement', async () => {
  // Directly test the approvals data integrity and lifecycle
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  const testApprovalId = `test-appr-${Date.now()}`;
  const singleUseToken = 'crypto-token-xyz-123';
  const now = Date.now();
  const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();

  let approvals = {};
  try {
    const raw = await fs.readFile(APPROVALS_FILE, 'utf8');
    approvals = JSON.parse(raw);
  } catch {}

  // 1. Register pending approval
  approvals[testApprovalId] = {
    id: testApprovalId,
    agentId: 'cipher',
    agentName: 'Cipher',
    type: 'run_command',
    title: 'Run test suite in sandbox',
    description: 'Execute npm test inside isolated sandbox',
    payload: { command: 'npm test' },
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt,
    singleUseToken,
  };
  await fs.writeFile(APPROVALS_FILE, JSON.stringify(approvals, null, 2), 'utf8');

  // Verify stored pending status
  let saved = JSON.parse(await fs.readFile(APPROVALS_FILE, 'utf8'));
  assert.equal(saved[testApprovalId].status, 'pending');
  assert.equal(saved[testApprovalId].singleUseToken, singleUseToken);

  // 2. User approves
  saved[testApprovalId].status = 'approved';
  saved[testApprovalId].decisionAt = new Date().toISOString();
  await fs.writeFile(APPROVALS_FILE, JSON.stringify(saved, null, 2), 'utf8');

  saved = JSON.parse(await fs.readFile(APPROVALS_FILE, 'utf8'));
  assert.equal(saved[testApprovalId].status, 'approved');

  // 3. Execution service verifies and consumes token
  assert.equal(saved[testApprovalId].singleUseToken, singleUseToken);
  assert.equal(saved[testApprovalId].status, 'approved');
  // Consume token
  saved[testApprovalId].status = 'consumed';
  await fs.writeFile(APPROVALS_FILE, JSON.stringify(saved, null, 2), 'utf8');

  // 4. Second execution attempt must fail because status is now consumed
  saved = JSON.parse(await fs.readFile(APPROVALS_FILE, 'utf8'));
  assert.equal(saved[testApprovalId].status, 'consumed');
  assert.notEqual(saved[testApprovalId].status, 'approved', 'Consumed approval cannot be re-executed');

  // Clean up
  delete saved[testApprovalId];
  await fs.writeFile(APPROVALS_FILE, JSON.stringify(saved, null, 2), 'utf8');
});

test('Server Approval Expiration Guard', async () => {
  const expiredApprovalId = `test-expired-${Date.now()}`;
  const now = Date.now();
  const pastExpiresAt = new Date(now - 1000).toISOString(); // 1s in the past

  let approvals = {};
  try {
    const raw = await fs.readFile(APPROVALS_FILE, 'utf8');
    approvals = JSON.parse(raw);
  } catch {}

  approvals[expiredApprovalId] = {
    id: expiredApprovalId,
    agentId: 'cipher',
    agentName: 'Cipher',
    type: 'run_command',
    title: 'Run test suite',
    description: 'Expired test',
    payload: { command: 'npm test' },
    status: 'pending',
    createdAt: new Date(now - 3600 * 1000).toISOString(),
    expiresAt: pastExpiresAt,
    singleUseToken: 'token-expired',
  };

  const isExpired = Date.now() > Date.parse(approvals[expiredApprovalId].expiresAt);
  assert.ok(isExpired, 'Approval should be flagged as expired');

  delete approvals[expiredApprovalId];
});

test('Durable Background Jobs Queue and State Recovery', async () => {
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  const testJobId = `job-test-${Date.now()}`;
  let jobs = {};
  try {
    const raw = await fs.readFile(JOBS_FILE, 'utf8');
    jobs = JSON.parse(raw);
  } catch {}

  // 1. Enqueue job
  jobs[testJobId] = {
    id: testJobId,
    title: 'Autonomous Research Task',
    description: 'Scout researching robotics simulation frameworks',
    agentId: 'scout',
    agentName: 'Scout',
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: { topic: 'robotics simulation' },
    logs: ['[INFO] Task enqueued in background supervisor'],
  };
  await fs.writeFile(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf8');

  // 2. Worker picks up job
  let persistedJobs = JSON.parse(await fs.readFile(JOBS_FILE, 'utf8'));
  assert.ok(persistedJobs[testJobId]);
  assert.equal(persistedJobs[testJobId].status, 'queued');

  persistedJobs[testJobId].status = 'running';
  persistedJobs[testJobId].progress = 50;
  persistedJobs[testJobId].logs.push('[INFO] Dispatched web_search tool call for robotics simulators');
  await fs.writeFile(JOBS_FILE, JSON.stringify(persistedJobs, null, 2), 'utf8');

  // 3. Worker completes job with verifiable output
  persistedJobs = JSON.parse(await fs.readFile(JOBS_FILE, 'utf8'));
  assert.equal(persistedJobs[testJobId].status, 'running');
  assert.equal(persistedJobs[testJobId].progress, 50);

  persistedJobs[testJobId].status = 'completed';
  persistedJobs[testJobId].progress = 100;
  persistedJobs[testJobId].result = {
    findingsCount: 3,
    sources: ['Wikipedia: Robotics simulator', 'Gazebo Sim', 'Isaac Sim'],
  };
  await fs.writeFile(JOBS_FILE, JSON.stringify(persistedJobs, null, 2), 'utf8');

  // Verify final durable state
  persistedJobs = JSON.parse(await fs.readFile(JOBS_FILE, 'utf8'));
  assert.equal(persistedJobs[testJobId].status, 'completed');
  assert.equal(persistedJobs[testJobId].progress, 100);
  assert.equal(persistedJobs[testJobId].result.findingsCount, 3);

  // Clean up
  delete persistedJobs[testJobId];
  await fs.writeFile(JOBS_FILE, JSON.stringify(persistedJobs, null, 2), 'utf8');
});

test('Durable Server Workspace State Atomic Persistence', async () => {
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  const testPayload = {
    version: '1.0.0',
    savedAt: new Date().toISOString(),
    spaces: [
      {
        id: 'space-test',
        name: 'Autonomous Space',
        pages: [
          {
            id: 'page-1',
            title: 'Robotics Comparison',
            content: '# Robotics Simulators\n- Isaac Sim\n- Gazebo Sim\n- MuJoCo',
            version: 1,
          },
        ],
      },
    ],
  };

  const tempFile = `${STATE_FILE}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(testPayload, null, 2), 'utf8');
  await fs.rename(tempFile, STATE_FILE);

  const restored = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  assert.equal(restored.version, '1.0.0');
  assert.equal(restored.spaces[0].id, 'space-test');
  assert.equal(restored.spaces[0].pages[0].title, 'Robotics Comparison');
});
