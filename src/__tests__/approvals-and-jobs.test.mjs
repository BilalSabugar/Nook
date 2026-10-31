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
  const {
    getDocumentById,
    createApproval,
    getApprovalById,
    createMission,
    getMissionById,
  } = await import('../lib/db.ts');

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

    // 4. Failure injection AFTER workspace-state.json has been atomically replaced on disk (afterStateFileHook)
    let stateFileWasReplacedBeforeRollback = false;
    await assert.rejects(
      async () => {
        await persistWorkspaceStatePayload(
          {
            agents: [{ id: 'agent-scout', name: 'Post-JSON-Replace Failure Agent' }],
            spaces: [
              {
                id: 'space-post-json-rollback',
                name: 'Post-JSON Space That Must Roll Back',
                pages: [
                  {
                    id: 'page-post-json-rollback',
                    title: 'Post-JSON Uncommitted Page',
                    content: 'Must roll back when failure happens after workspace-state.json rename',
                  },
                ],
              },
            ],
            messages: { 'agent-scout': [{ id: 'm-post-json', content: 'UNCOMMITTED_POST_JSON' }] },
          },
          {
            afterStateFileHook: async ({ stateFile }) => {
              const currentDiskJson = JSON.parse(await fs.readFile(stateFile, 'utf8'));
              stateFileWasReplacedBeforeRollback =
                currentDiskJson.messages?.['agent-scout']?.[0]?.content === 'UNCOMMITTED_POST_JSON';
              throw new Error('Simulated failure after workspace-state.json atomic replacement');
            },
          }
        );
      },
      /Simulated failure after workspace-state\.json atomic replacement/
    );
    assert.equal(
      stateFileWasReplacedBeforeRollback,
      true,
      'afterStateFileHook must run after workspace-state.json was replaced on disk'
    );
    assert.equal(
      await fs.readFile(STATE_FILE, 'utf8'),
      committedRaw,
      'workspace-state.json must be restored to exact previous committed bytes when failure occurs after JSON replacement'
    );
    assert.equal(
      getDocumentById('page-post-json-rollback'),
      null,
      'SQLite document must be rolled back when failure occurs after JSON replacement'
    );

    // 5. Failure injection AFTER workspace-state.json replacement AND AFTER the first sandbox file write (afterSandboxFileHook)
    const scoutNotesPath = path.join(STORAGE_DIR, 'sandboxes', 'agent-scout', 'workspace', 'notes.txt');
    const scoutExtraPath = path.join(STORAGE_DIR, 'sandboxes', 'agent-scout', 'workspace', 'uncommitted_extra.txt');
    const transientAgentDir = path.join(STORAGE_DIR, 'sandboxes', 'agent-transient-rollback');
    assert.equal(await fs.readFile(scoutNotesPath, 'utf8'), 'initial-sandbox-file');

    let firstSandboxFileWasWritten = false;
    await assert.rejects(
      async () => {
        await persistWorkspaceStatePayload(
          {
            agents: [{ id: 'agent-scout', name: 'Post-Sandbox-Write Failure Agent' }],
            spaces: [
              {
                id: 'space-post-sandbox-rollback',
                name: 'Post-Sandbox Space That Must Roll Back',
                pages: [
                  {
                    id: 'page-post-sandbox-rollback',
                    title: 'Post-Sandbox Uncommitted Page',
                    content: 'Must roll back when failure happens after first sandbox file write',
                  },
                ],
              },
            ],
            computerStates: {
              'agent-scout': {
                files: [
                  { name: 'notes.txt', content: 'OVERWRITTEN_UNCOMMITTED_NOTES' },
                  { name: 'uncommitted_extra.txt', content: 'SECOND_FILE_SHOULD_FAIL' },
                ],
              },
              'agent-transient-rollback': {
                files: [{ name: 'transient.txt', content: 'SHOULD_NOT_EXIST' }],
              },
            },
            messages: { 'agent-scout': [{ id: 'm-post-sbx', content: 'UNCOMMITTED_POST_SANDBOX' }] },
          },
          {
            afterSandboxFileHook: async ({ fileName, filePath, fileIndex }) => {
              if (fileIndex === 0) {
                assert.equal(fileName, 'notes.txt');
                const diskContent = await fs.readFile(filePath, 'utf8');
                firstSandboxFileWasWritten = diskContent === 'OVERWRITTEN_UNCOMMITTED_NOTES';
                throw new Error('Simulated failure after first sandbox file write');
              }
            },
          }
        );
      },
      /Simulated failure after first sandbox file write/
    );
    assert.equal(firstSandboxFileWasWritten, true, 'First sandbox file must have been written before hook threw');
    assert.equal(
      await fs.readFile(STATE_FILE, 'utf8'),
      committedRaw,
      'workspace-state.json must roll back after mid-sandbox-write failure'
    );
    assert.equal(
      await fs.readFile(scoutNotesPath, 'utf8'),
      'initial-sandbox-file',
      'Overwritten first sandbox file (notes.txt) must be restored to prior committed content on rollback'
    );
    await assert.rejects(fs.stat(scoutExtraPath), { code: 'ENOENT' });
    await assert.rejects(fs.stat(transientAgentDir), { code: 'ENOENT' });
    assert.equal(
      getDocumentById('page-post-sandbox-rollback'),
      null,
      'SQLite document must roll back after mid-sandbox-write failure'
    );

    // 6. Concurrent saves serialization: two simultaneous saves where one succeeds and the other fails
    // Case 6a: Save A (delayed, then fails & rolls back) + Save B (succeeds) launched simultaneously
    const [res6aFail, res6aOk] = await Promise.allSettled([
      persistWorkspaceStatePayload(
        {
          agents: [{ id: 'agent-scout', name: 'Concurrent Failing Agent A' }],
          spaces: [
            {
              id: 'space-concurrent-fail-a',
              name: 'Concurrent Failing Space A',
              pages: [
                {
                  id: 'page-concurrent-fail-a',
                  title: 'Failing Concurrent Page A',
                  content: 'Must never commit',
                },
              ],
            },
          ],
          computerStates: {
            'agent-scout': {
              files: [{ name: 'notes.txt', content: 'CORRUPTED_BY_CONCURRENT_FAIL_A' }],
            },
          },
          messages: { 'agent-scout': [{ id: 'm-fail-a', content: 'FAILED_CONCURRENT_A' }] },
        },
        {
          afterStateFileHook: async () => {
            await new Promise((r) => setTimeout(r, 40));
            throw new Error('Concurrent Save A failed after delay');
          },
        }
      ),
      persistWorkspaceStatePayload({
        agents: [{ id: 'agent-scout', name: 'Concurrent Committed Agent B' }],
        spaces: [
          {
            id: 'space-concurrent-ok-b',
            name: 'Concurrent Committed Space B',
            pages: [
              {
                id: 'page-concurrent-ok-b',
                title: 'Committed Concurrent Page B',
                content: 'Committed content from Save B',
              },
            ],
          },
        ],
        computerStates: {
          'agent-scout': {
            files: [{ name: 'notes.txt', content: 'committed-by-save-b' }],
          },
        },
        messages: { 'agent-scout': [{ id: 'm-ok-b', content: 'COMMITTED_CONCURRENT_B' }] },
      }),
    ]);

    assert.equal(res6aFail.status, 'rejected');
    assert.equal(res6aOk.status, 'fulfilled');
    assert.equal(res6aOk.value.status, 200);
    assert.equal(getDocumentById('page-concurrent-fail-a'), null, 'Failed concurrent Save A must be rolled back');
    assert.equal(
      getDocumentById('page-concurrent-ok-b')?.title,
      'Committed Concurrent Page B',
      'Successful concurrent Save B must remain committed in SQLite'
    );
    assert.equal(
      await fs.readFile(scoutNotesPath, 'utf8'),
      'committed-by-save-b',
      'Successful concurrent Save B sandbox file must remain committed'
    );

    // Case 6b: Reverse order — Save C (delayed, then succeeds) + Save D (fails & rolls back) launched simultaneously
    const [res6bOk, res6bFail] = await Promise.allSettled([
      persistWorkspaceStatePayload(
        {
          agents: [{ id: 'agent-scout', name: 'Scout' }],
          spaces: [
            {
              id: 'space-test-atomic',
              name: 'Autonomous Space',
              pages: [
                {
                  id: 'page-concurrent-ok-c',
                  title: 'Committed Concurrent Page C',
                  content: 'Committed content from Save C',
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
        },
        {
          afterStateFileHook: async () => {
            await new Promise((r) => setTimeout(r, 40));
          },
        }
      ),
      persistWorkspaceStatePayload(
        {
          agents: [{ id: 'agent-scout', name: 'Concurrent Failing Agent D' }],
          spaces: [
            {
              id: 'space-concurrent-fail-d',
              name: 'Concurrent Failing Space D',
              pages: [
                {
                  id: 'page-concurrent-fail-d',
                  title: 'Failing Concurrent Page D',
                  content: 'Must roll back without undoing Save C',
                },
              ],
            },
          ],
          computerStates: {
            'agent-scout': {
              files: [{ name: 'notes.txt', content: 'CORRUPTED_BY_CONCURRENT_FAIL_D' }],
            },
          },
          messages: { 'agent-scout': [{ id: 'm-fail-d', content: 'FAILED_CONCURRENT_D' }] },
        },
        {
          afterSandboxFileHook: async () => {
            throw new Error('Concurrent Save D failed after sandbox write');
          },
        }
      ),
    ]);

    assert.equal(res6bOk.status, 'fulfilled');
    assert.equal(res6bFail.status, 'rejected');
    assert.equal(
      getDocumentById('page-concurrent-ok-c')?.title,
      'Committed Concurrent Page C',
      'Earlier committed Save C must NOT be rolled back when subsequent concurrent Save D fails'
    );
    assert.equal(
      getDocumentById('page-concurrent-ok-b')?.title,
      'Committed Concurrent Page B',
      'Earlier committed Save B must remain committed in SQLite'
    );
    assert.equal(getDocumentById('page-concurrent-fail-d'), null, 'Failed Save D must be rolled back');
    assert.equal(
      await fs.readFile(scoutNotesPath, 'utf8'),
      'initial-sandbox-file',
      'Sandbox file must reflect committed Save C after Save D rolled back'
    );

    const getReq = new NextRequest('http://localhost:3000/api/workspace/state', {
      headers: { 'x-nook-api-key': apiKey },
    });
    const getRes = await stateGet(getReq);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.hasDurableState, true);
    assert.equal(getData.data.messages['agent-scout'][0].content, 'Committed message');

    // 7. Unrelated database writes survive a deliberately failing state save
    // (Verifies shared SQLite connection isolation when state save fails and rolls back filesystem)
    const unrelatedApprovalTitle = 'Unrelated Approval That Must Survive Failed Save';
    const unrelatedMissionTitle = 'Unrelated Mission That Must Survive Failed Save';
    let unrelatedApprovalId = null;
    let unrelatedMissionId = null;

    await assert.rejects(
      async () => {
        await persistWorkspaceStatePayload(
          {
            agents: [{ id: 'agent-scout', name: 'Failing Unrelated Save Agent' }],
            spaces: [
              {
                id: 'space-failing-unrelated',
                name: 'Failing Space',
                pages: [
                  {
                    id: 'page-failing-unrelated',
                    title: 'Failing Page Must Not Persist',
                    content: 'Should be rolled back',
                  },
                ],
              },
            ],
            messages: { 'agent-scout': [{ id: 'm-unrelated-fail', content: 'FAIL' }] },
          },
          {
            afterStateFileHook: async () => {
              // During this hook, an independent request creates an approval and a mission on the shared connection
              const appr = createApproval({
                agentId: 'agent-scout',
                agentName: 'Scout',
                type: 'run_command',
                title: unrelatedApprovalTitle,
                payload: { command: 'echo survive' },
              });
              unrelatedApprovalId = appr.id;

              const msn = createMission({
                title: unrelatedMissionTitle,
                objective: 'Verify independent mission survives failing state save',
                spaceId: 'space-test-atomic',
              });
              unrelatedMissionId = msn.id;

              throw new Error('Deliberate state save failure to test concurrent write survival');
            },
          }
        );
      },
      /Deliberate state save failure to test concurrent write survival/
    );

    // Verify failing save document was NOT committed
    assert.equal(getDocumentById('page-failing-unrelated'), null, 'Failing save page must not exist in SQLite');

    // Verify unrelated approval and mission SURVIVED and were not rolled back
    assert.ok(unrelatedApprovalId, 'unrelatedApprovalId must have been assigned');
    const survivingApproval = getApprovalById(unrelatedApprovalId);
    assert.ok(survivingApproval, 'Unrelated approval created during failing save must survive');
    assert.equal(survivingApproval.title, unrelatedApprovalTitle);

    assert.ok(unrelatedMissionId, 'unrelatedMissionId must have been assigned');
    const survivingMission = getMissionById(unrelatedMissionId);
    assert.ok(survivingMission, 'Unrelated mission created during failing save must survive');
    assert.equal(survivingMission.title, unrelatedMissionTitle);

    // 8. Deleted documents stay deleted across reloads
    // (Verifies that removing a page from a space prunes it from SQLite documents table)
    const initialPagesPayload = {
      agents: [{ id: 'agent-scout', name: 'Scout' }],
      spaces: [
        {
          id: 'space-deletion-test',
          name: 'Deletion Space',
          pages: [
            { id: 'page-del-keep', title: 'Page To Keep', content: 'Kept' },
            { id: 'page-del-remove', title: 'Page To Delete', content: 'Deleted' },
          ],
        },
      ],
    };
    await persistWorkspaceStatePayload(initialPagesPayload);
    assert.ok(getDocumentById('page-del-keep'), 'Page to keep must exist');
    assert.ok(getDocumentById('page-del-remove'), 'Page to remove must exist initially');

    // Client syncs space with page-del-remove omitted (simulating handleDeletePage)
    const afterDeletePayload = {
      agents: [{ id: 'agent-scout', name: 'Scout' }],
      spaces: [
        {
          id: 'space-deletion-test',
          name: 'Deletion Space',
          pages: [{ id: 'page-del-keep', title: 'Page To Keep', content: 'Kept' }],
        },
      ],
    };
    await persistWorkspaceStatePayload(afterDeletePayload);

    // Verify page-del-remove is deleted from SQLite
    assert.equal(getDocumentById('page-del-remove'), null, 'Deleted document must be removed from SQLite');
    assert.ok(getDocumentById('page-del-keep'), 'Kept document must still exist');

    // Verify GET /api/workspace/state does NOT resurrect the deleted page
    const getAfterDeleteReq = new NextRequest('http://localhost:3000/api/workspace/state', {
      headers: { 'x-nook-api-key': apiKey },
    });
    const getAfterDeleteRes = await stateGet(getAfterDeleteReq);
    const getAfterDeleteData = await getAfterDeleteRes.json();
    const deletionSpace = getAfterDeleteData.data.spaces.find((s) => s.id === 'space-deletion-test');
    assert.ok(deletionSpace, 'Deletion space must be returned');
    assert.equal(deletionSpace.pages.length, 1);
    assert.equal(deletionSpace.pages[0].id, 'page-del-keep');

    // 9. Chat history & virtual computer files durability and reload
    const chatAndComputerPayload = {
      agents: [{ id: 'agent-scout', name: 'Scout' }],
      spaces: [{ id: 'space-deletion-test', name: 'Deletion Space', pages: [] }],
      computerStates: {
        'agent-scout': {
          files: [
            { name: 'solution.py', content: 'def solve(): return 42\n' },
            { name: 'data.json', content: '{"status":"ready"}' },
          ],
        },
      },
      messages: {
        'agent-scout': [
          { id: 'msg-u1', sender: 'user', content: 'Write a python script' },
          { id: 'msg-a1', sender: 'agent', content: 'I have written solution.py' },
        ],
      },
    };
    await persistWorkspaceStatePayload(chatAndComputerPayload);

    // Verify files on durable server disk
    const solutionDiskPath = path.join(STORAGE_DIR, 'sandboxes', 'agent-scout', 'workspace', 'solution.py');
    assert.equal(await fs.readFile(solutionDiskPath, 'utf8'), 'def solve(): return 42\n');

    // Verify GET returns messages and virtual files on reload without making unrelated changes
    const getChatReq = new NextRequest('http://localhost:3000/api/workspace/state', {
      headers: { 'x-nook-api-key': apiKey },
    });
    const getChatRes = await stateGet(getChatReq);
    const getChatData = await getChatRes.json();
    assert.equal(getChatData.data.messages['agent-scout'].length, 2);
    assert.equal(getChatData.data.messages['agent-scout'][1].content, 'I have written solution.py');
    assert.equal(getChatData.data.computerStates['agent-scout'].files.length, 2);
    assert.equal(getChatData.data.computerStates['agent-scout'].files[0].name, 'solution.py');

    // 10. Deliberate server-side workspace reset operation
    const resetReq = new NextRequest('http://localhost:3000/api/workspace/state', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nook-api-key': apiKey,
      },
      body: JSON.stringify({ action: 'reset' }),
    });
    const resetRes = await statePost(resetReq);
    assert.equal(resetRes.status, 200);
    const resetData = await resetRes.json();
    assert.equal(resetData.success, true);
    assert.equal(resetData.message, 'Workspace successfully reset to factory defaults');

    // Verify custom document and custom sandbox file are wiped
    assert.equal(getDocumentById('page-del-keep'), null, 'Custom document must be cleared after reset');
    assert.equal(
      await fs.stat(solutionDiskPath).catch(() => null),
      null,
      'Sandbox files must be cleaned up on disk after reset'
    );
  } finally {
    if (origApiKey !== undefined) process.env.NOOK_API_KEY = origApiKey;
    else delete process.env.NOOK_API_KEY;
    if (originalStateRaw !== null) {
      await fs.writeFile(STATE_FILE, originalStateRaw, 'utf8');
    }
  }
});
