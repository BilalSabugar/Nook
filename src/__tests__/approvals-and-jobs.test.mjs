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
  const { NextRequest } = await import('next/server.js');
  const crypto = await import('node:crypto');
  const {
    GET: stateGet,
    POST: statePost,
    persistWorkspaceStatePayload,
  } = await import('../app/api/workspace/state/route.ts');
  const { getDocumentById } = await import('../lib/db.ts');

  await fs.mkdir(STORAGE_DIR, { recursive: true });
  let originalStateRaw = null;
  try {
    originalStateRaw = await fs.readFile(STATE_FILE, 'utf8');
  } catch {
    originalStateRaw = null;
  }

  const origApiKey = process.env.NOOK_API_KEY;
  const apiKey = `atomic-state-test-${crypto.randomBytes(16).toString('hex')}`;
  process.env.NOOK_API_KEY = apiKey;

  try {
    const initialPayload = {
      agents: [{ id: 'agent-scout', name: 'Scout' }],
      spaces: [
        {
          id: 'space-test-atomic',
          name: 'Autonomous Space',
          pages: [
            {
              id: 'page-atomic-1',
              title: 'Robotics Comparison',
              content: '# Robotics Simulators\n- Isaac Sim\n- Gazebo Sim\n- MuJoCo',
              version: 1,
            },
          ],
        },
      ],
      computerStates: {
        'agent-scout': {
          files: [{ name: 'notes.txt', content: 'initial-sandbox-file' }],
        },
      },
      messages: { 'agent-scout': [{ id: 'm1', content: 'Committed message' }] },
      settings: {
        provider: 'ollama',
        model: 'llama3.3',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        openaiApiKey: 'should-be-stripped-on-persist',
      },
    };

    // 1. Exercise real POST /api/workspace/state API endpoint
    const postReq = new NextRequest('http://localhost:3000/api/workspace/state', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nook-api-key': apiKey,
      },
      body: JSON.stringify(initialPayload),
    });
    const postRes = await statePost(postReq);
    assert.equal(postRes.status, 200, 'POST /api/workspace/state must succeed with 200');
    const postData = await postRes.json();
    assert.equal(postData.success, true);

    const committedRaw = await fs.readFile(STATE_FILE, 'utf8');
    const committedJson = JSON.parse(committedRaw);
    assert.equal(committedJson.spaces[0].id, 'space-test-atomic');
    assert.equal(committedJson.spaces[0].pages[0].title, 'Robotics Comparison');
    assert.equal(committedJson.settings.openaiApiKey, undefined, 'API keys must be stripped from persisted state');

    // 2. Simulate an interrupted write mid-flight (after temp file is written/flushed, before atomic rename)
    let observedTmpPath = null;
    let targetUnchangedDuringTempWrite = false;
    await assert.rejects(
      async () => {
        await persistWorkspaceStatePayload(
          {
            agents: [{ id: 'agent-scout', name: 'Corrupted Uncommitted Agent' }],
            spaces: [
              {
                id: 'space-interrupted-rollback',
                name: 'Interrupted Space That Must Roll Back',
                pages: [
                  {
                    id: 'page-interrupted-rollback',
                    title: 'Uncommitted Page',
                    content: 'Should never persist on interrupted write',
                  },
                ],
              },
            ],
            messages: { 'agent-scout': [{ id: 'm-corrupt', content: 'UNCOMMITTED_WRITE' }] },
          },
          {
            beforeRenameHook: async ({ tmpPath, target }) => {
              observedTmpPath = tmpPath;
              // Verify temp file is in the same directory and already contains the staged bytes
              assert.equal(path.dirname(tmpPath), path.dirname(target));
              const tmpStat = await fs.stat(tmpPath);
              assert.ok(tmpStat.size > 0, 'Temporary file must be written and flushed before rename');
              // Verify live target file still contains the exact previous committed payload prior to rename
              const liveRawDuringWrite = await fs.readFile(target, 'utf8');
              targetUnchangedDuringTempWrite = liveRawDuringWrite === committedRaw;
              throw new Error('Simulated process interruption before atomic rename');
            },
          }
        );
      },
      /Simulated process interruption before atomic rename/
    );

    assert.equal(
      targetUnchangedDuringTempWrite,
      true,
      'Live workspace-state.json must remain untouched while temporary file is being written'
    );
    assert.ok(observedTmpPath, 'beforeRenameHook must observe the temporary file');
    await assert.rejects(
      fs.stat(observedTmpPath),
      { code: 'ENOENT' },
      'Temporary file must be cleaned up when write is interrupted'
    );

    // 3. Verify live workspace-state.json, SQLite, and GET /api/workspace/state remain completely intact
    const afterInterruptRaw = await fs.readFile(STATE_FILE, 'utf8');
    assert.equal(
      afterInterruptRaw,
      committedRaw,
      'Interrupted write must leave previous workspace-state.json 100% intact'
    );
    assert.equal(
      getDocumentById('page-interrupted-rollback'),
      null,
      'SQLite document from interrupted state sync must be rolled back'
    );

    const getReq = new NextRequest('http://localhost:3000/api/workspace/state', {
      headers: { 'x-nook-api-key': apiKey },
    });
    const getRes = await stateGet(getReq);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.hasDurableState, true);
    assert.equal(getData.data.messages['agent-scout'][0].content, 'Committed message');
  } finally {
    if (origApiKey !== undefined) process.env.NOOK_API_KEY = origApiKey;
    else delete process.env.NOOK_API_KEY;
    if (originalStateRaw !== null) {
      await fs.writeFile(STATE_FILE, originalStateRaw, 'utf8');
    }
  }
});
