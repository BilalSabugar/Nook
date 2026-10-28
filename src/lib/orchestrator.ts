import {
  createMission,
  getMissionById,
  createAgentTask,
  getAgentTaskById,
  listTasksForMission,
  updateAgentTask,
  addAgentTaskObservation,
  verifyAgentTask,
  recordEvidence,
  saveDocumentWithRevision,
  createApproval,
  getApprovalById,
  verifyAndConsumeApproval,
  acquireWorkerLease,
  releaseWorkerLease,
  validateWorkerLease,
  renewWorkerLeaseHeartbeat,
  commitMissionStateWithFencing,
} from './db.ts';
import type { DbMission, DbAgentTask } from './db.ts';
import { safeFetch } from './ssrf.ts';
import { executeSandboxedCommand } from './sandbox.ts';
import path from 'path';
import fs from 'fs/promises';

export interface MissionPlanInput {
  title: string;
  objective: string;
  priority?: 'low' | 'medium' | 'high';
  requiresCodeExecution?: boolean;
  codeGenerationMode?: 'model' | 'template' | 'auto';
  modelOptions?: {
    apiKey?: string;
    model?: string;
    provider?: string;
    endpoint?: string;
  };
}

import { planSolutionAndTests, synthesizeSolutionWithModel } from './solution-planner.ts';
import { verifyStructuredTestOutput } from './test-verifier.ts';
export { planSolutionAndTests, synthesizeSolutionWithModel, verifyStructuredTestOutput };

/**
 * Aura's planning engine: decomposes high-level user objective into structured,
 * dependent tasks for Scout, Quill, and Cipher.
 */
export function planMission(input: MissionPlanInput): DbMission {
  // 1. Create durable Mission record
  const mission = createMission({
    title: input.title,
    objective: input.objective,
    priority: input.priority || 'medium',
    milestones: [
      { id: 'm1', title: 'Intelligence & Source Verification', status: 'pending', taskIds: [] },
      { id: 'm2', title: 'Knowledge Space Document Synthesis', status: 'pending', taskIds: [] },
      ...(input.requiresCodeExecution
        ? [{ id: 'm3', title: 'Isolated Implementation & Test Suite', status: 'pending' as const, taskIds: [] }]
        : []),
    ],
  });

  // Task 1: Scout Intelligence Gathering
  const task1 = createAgentTask({
    missionId: mission.id,
    title: 'Research & Source Verification',
    goal: `Investigate "${input.objective}", verify facts, and gather real citations.`,
    assignedAgentId: 'agent-scout',
    priority: 'high',
    inputs: { topic: input.objective },
  });

  // Task 2: Quill Document Synthesis (depends on Task 1)
  const task2 = createAgentTask({
    missionId: mission.id,
    title: 'Technical Synthesis & Document Creation',
    goal: `Format and publish a structured briefing page into Living Spaces with revision tracking.`,
    assignedAgentId: 'agent-quill',
    dependencies: [task1.id],
    priority: 'medium',
    inputs: { targetSpaceId: 'space-research', documentTitle: input.title },
  });

  // Optional Task 3: Cipher Engineering & Test Execution (depends on Task 1 and 2)
  let task3: DbAgentTask | undefined;
  if (input.requiresCodeExecution) {
    const codeSpec = planSolutionAndTests(input.objective);
    task3 = createAgentTask({
      missionId: mission.id,
      title: 'Sandbox Implementation & Test Verification',
      goal: `Implement requested solution for "${input.objective}" and execute automated verification test suite.`,
      assignedAgentId: 'agent-cipher',
      dependencies: [task2.id],
      priority: 'high',
      inputs: {
        solutionFile: codeSpec.solutionFile,
        solutionContent: codeSpec.solutionContent,
        testFile: codeSpec.testFile,
        testContent: codeSpec.testContent,
        command: codeSpec.command,
        codeGenerationMode: input.codeGenerationMode || 'auto',
        modelOptions: input.modelOptions,
      },
    });
  }

  // Record Evidence of Aura's plan
  recordEvidence({
    missionId: mission.id,
    agentId: 'agent-aura',
    agentName: 'Aura',
    actionType: 'model_call',
    summary: `Aura generated strategic execution plan with ${input.requiresCodeExecution ? 3 : 2} dependent tasks`,
    details: {
      planSummary: input.objective,
      milestonesCount: mission.milestones.length,
      tasks: [task1.title, task2.title, task3?.title].filter(Boolean),
    },
  });

  return getMissionById(mission.id)!;
}

/**
 * Executes a single pending or in-progress task for an agent.
 */
export async function executeTaskStep(task: DbAgentTask): Promise<DbAgentTask> {
  // Check dependencies
  if (task.dependencies.length > 0) {
    for (const depId of task.dependencies) {
      const dep = getAgentTaskById(depId);
      if (!dep || dep.status !== 'completed') {
        updateAgentTask(task.id, { status: 'blocked' });
        return getAgentTaskById(task.id)!;
      }
    }
  }

  // -------------------------------------------------------------
  // SCOUT RESEARCH EXECUTION
  // -------------------------------------------------------------
  if (task.assignedAgentId === 'agent-scout') {
    updateAgentTask(task.id, { status: 'in_progress' });
    const topic = String(task.inputs.topic || task.goal);
    addAgentTaskObservation(task.id, {
      tool: 'web_search',
      input: { query: topic },
      output: 'Dispatching Wikipedia OpenSearch API query',
      status: 'success',
    });

    let titles: string[] = [];
    let links: string[] = [];
    let descriptions: string[] = [];

    // Extract meaningful search query (remove prompt stop phrases)
    const cleanQuery = topic
      .replace(/^(research|investigate|study|compare|analyze|build|test|evaluate)\s+/gi, '')
      .replace(/\s+(and\s+(synthesize|prepare|present|write|compile|test|build|deliver|summarize)\s+[a-z\s]+)$/gi, '')
      .replace(/and prepare a report/gi, '')
      .trim()
      .slice(0, 60);

    const searchedQuery = cleanQuery || topic.slice(0, 40);
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(searchedQuery)}&limit=4&namespace=0&format=json`;

    try {
      const fetchRes = await safeFetch(searchUrl, { timeoutMs: 6000 });

      if (fetchRes.ok) {
        const parsed = JSON.parse(fetchRes.bodyText);
        titles = parsed[1] || [];
        descriptions = parsed[2] || [];
        links = parsed[3] || [];
      }
    } catch (err: unknown) {
      const error = err as Error;
      addAgentTaskObservation(task.id, {
        tool: 'web_search',
        output: `Search network notice: ${error.message}`,
        status: 'warning',
      });
    }

    // Explicitly categorize sources: searched, retrieved, and supporting
    const searchedQueries = [searchedQuery];
    const searchedSources = [searchUrl];
    const retrievedSources = [...links];

    // Inspect actual source content via safeFetch to verify claims against primary text
    const verifiedClaims: Array<{ sourceUrl: string; sourceTitle: string; snippet: string; verified: boolean; quotedEvidence?: string }> = [];
    const verifiedCitations: string[] = [];

    // Extract substantive content terms from research query (excluding common stopwords)
    const stopwords = new Set(['the', 'and', 'with', 'for', 'about', 'which', 'that', 'from', 'this', 'have', 'what', 'when', 'where', 'some', 'into', 'over', 'more', 'how', 'why', 'can']);
    const claimKeywords = searchedQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopwords.has(w));

    for (let idx = 0; idx < Math.min(links.length, 3); idx++) {
      const link = links[idx];
      const title = titles[idx] || 'Source Document';
      const desc = (descriptions[idx] || '').trim();
      if (!desc || desc.toLowerCase().includes('may refer to')) continue;

      try {
        const pageRes = await safeFetch(link, { timeoutMs: 4000 });
        if (pageRes.ok && pageRes.bodyText) {
          // Clean page text
          const cleanText = pageRes.bodyText
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          // Split into sentences for claim-to-source evidence verification
          const sentences = cleanText
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 35 && s.length <= 450);

          let bestSentence = '';
          let maxMatches = 0;

          for (const sentence of sentences) {
            const sLower = sentence.toLowerCase();
            if (sLower.includes('may refer to') || sLower.includes('disambiguation') || sLower.includes('external links')) {
              continue;
            }
            const matchCount = claimKeywords.filter((kw) => sLower.includes(kw)).length;
            if (matchCount > maxMatches) {
              maxMatches = matchCount;
              bestSentence = sentence;
            }
          }

          // Rigorous evidentiary threshold: sentence must substantiate the claim
          const minRequiredMatches = Math.min(2, Math.max(1, Math.ceil(claimKeywords.length * 0.4)));
          const claimSupported = maxMatches >= minRequiredMatches && bestSentence.length > 0;

          if (claimSupported) {
            verifiedCitations.push(link);
            verifiedClaims.push({
              sourceUrl: link,
              sourceTitle: title,
              snippet: bestSentence,
              quotedEvidence: bestSentence,
              verified: true,
            });
          } else {
            verifiedClaims.push({
              sourceUrl: link,
              sourceTitle: title,
              snippet: bestSentence || 'Source document does not contain verifiable sentence substantiating the claim.',
              verified: false,
            });
          }
        }
      } catch {
        // Fetch or DNS pinning check failed or timed out
      }
    }

    const supportingSources = verifiedCitations;

    if (supportingSources.length > 0) {
      const citations = supportingSources;
      const summaryFindings = titles.map((t, i) => `${t}: ${descriptions[i] || 'Overview'}`).join('; ');

      recordEvidence({
        missionId: task.missionId,
        taskId: task.id,
        agentId: 'agent-scout',
        agentName: 'Scout',
        actionType: 'browser_visit',
        summary: `Scout inspected and verified ${citations.length} primary source citations against page content`,
        details: {
          searchedQueries,
          searchedSources,
          retrievedSources,
          supportingSources,
          sourceCitations: citations,
          verifiedClaims,
          findings: summaryFindings,
          sourceTitles: titles,
        },
      });

      verifyAgentTask(task.id, {
        verified: true,
        method: 'citation_validation',
        details: `Verified ${citations.length} authentic source links after inspecting primary page content.`,
      });

      return updateAgentTask(task.id, {
        status: 'completed',
        outputs: {
          searchedQueries,
          searchedSources,
          retrievedSources,
          supportingSources,
          citations,
          verifiedClaims,
          findings: summaryFindings,
          sourceTitles: titles,
        },
      })!;
    } else {
      // HONEST RECORDING: NO SUBSTITUTE URL!
      const summaryFindings = `No authoritative external sources found supporting query "${searchedQuery}".`;

      recordEvidence({
        missionId: task.missionId,
        taskId: task.id,
        agentId: 'agent-scout',
        agentName: 'Scout',
        actionType: 'browser_visit',
        summary: `Search yielded 0 authoritative source citations for query`,
        details: {
          searchedQueries,
          searchedSources,
          retrievedSources,
          supportingSources: [],
          sourceCitations: [],
          findings: summaryFindings,
          sourceTitles: [],
        },
        status: 'failed',
      });

      verifyAgentTask(task.id, {
        verified: false,
        method: 'citation_validation',
        details: `Unverified: No authoritative source citations found matching "${searchedQuery}". Zero citations fabricated.`,
      });

      return updateAgentTask(task.id, {
        status: 'completed',
        outputs: {
          searchedQueries,
          searchedSources,
          retrievedSources,
          supportingSources: [],
          citations: [],
          findings: summaryFindings,
          sourceTitles: [],
        },
      })!;
    }
  }

  // -------------------------------------------------------------
  // QUILL DOCUMENT EXECUTION
  // -------------------------------------------------------------
  if (task.assignedAgentId === 'agent-quill') {
    updateAgentTask(task.id, { status: 'in_progress' });

    // Collect research outputs from dependencies
    let citations: string[] = [];
    let findings = 'Foundational architecture principles.';
    let isUpstreamVerified = true;

    for (const depId of task.dependencies) {
      const dep = getAgentTaskById(depId);
      if (dep) {
        if (dep.verification && dep.verification.verified === false) {
          isUpstreamVerified = false;
        }
        if (dep.outputs?.citations) {
          citations = citations.concat(dep.outputs.citations as string[]);
        }
        if (dep.outputs?.findings) {
          findings = String(dep.outputs.findings);
        }
      }
    }

    if (citations.length === 0) {
      isUpstreamVerified = false;
    }

    const rawTitle = String(task.inputs.documentTitle || task.title);
    const docTitle = isUpstreamVerified ? rawTitle : `${rawTitle} [Unverified Draft]`;
    const spaceId = String(task.inputs.targetSpaceId || 'space-research');
    const docId = `doc-briefing-${task.missionId}`;

    const citationsList = citations.length > 0
      ? citations.map((c) => `- [${c}](${c})`).join('\n')
      : '_No external citations verified for this topic._';

    const documentContent = `# ${docTitle}

> **Executive Briefing & Technical Investigation**
> Prepared by Quill, synthesized from Scout's investigation.
> Verification Status: ${isUpstreamVerified ? 'VERIFIED PRIMARY SOURCES' : 'UNVERIFIED PRELIMINARY DRAFT'}

## Core Findings
${findings}

## Verified Source Citations
${citationsList}

## Architecture Review
- **Integrity**: ${isUpstreamVerified ? 'Cross-verified against primary specifications.' : 'Preliminary claims awaiting independent primary source verification.'}
- **Verification Status**: Sealed into Living Spaces with immutable revision log.
`;

    // Persist document into SQLite Living Spaces
    saveDocumentWithRevision({
      id: docId,
      spaceId,
      title: docTitle,
      content: documentContent,
      excerpt: findings.slice(0, 160),
      icon: isUpstreamVerified ? 'file-text' : 'alert-circle',
      authorAgentId: 'agent-quill',
      tags: isUpstreamVerified
        ? ['mission-output', 'briefing', 'verified']
        : ['mission-output', 'briefing', 'unverified'],
      changeSummary: `Created technical briefing page for mission ${task.missionId}`,
    });

    addAgentTaskObservation(task.id, {
      tool: 'format_document',
      input: { docId, spaceId },
      output: `Published document ${docId} with ${documentContent.length} bytes to space ${spaceId} (verified: ${isUpstreamVerified})`,
      status: isUpstreamVerified ? 'success' : 'warning',
    });

    recordEvidence({
      missionId: task.missionId,
      taskId: task.id,
      agentId: 'agent-quill',
      agentName: 'Quill',
      actionType: 'file_write',
      summary: `Quill published document "${docTitle}" to Living Space (verified: ${isUpstreamVerified})`,
      details: {
        documentId: docId,
        spaceId,
        version: 1,
        contentLength: documentContent.length,
        verified: isUpstreamVerified,
      },
      status: isUpstreamVerified ? 'success' : 'warning',
    });

    verifyAgentTask(task.id, {
      verified: isUpstreamVerified,
      method: 'schema_check',
      details: isUpstreamVerified
        ? `Living Space document ${docId} confirmed created with verified primary sources.`
        : `Living Space document ${docId} marked unverified due to lack of verified upstream source citations.`,
    });

    return updateAgentTask(task.id, {
      status: 'completed',
      outputs: {
        documentId: docId,
        spaceId,
        artifacts: [`living-spaces://${spaceId}/${docId}`],
      },
    })!;
  }

  // -------------------------------------------------------------
  // CIPHER ENGINEERING & SANDBOX EXECUTION
  // -------------------------------------------------------------
  if (task.assignedAgentId === 'agent-cipher') {
    const safeAgentId = 'agent-cipher';
    const taskWorkspaceDir = path.resolve(process.cwd(), '.nook_sandboxes', safeAgentId, 'tasks', task.id);
    await fs.mkdir(taskWorkspaceDir, { recursive: true });

    // Step 0: Determine if dynamic model synthesis is requested
    let solutionFile = String(task.inputs.solutionFile || 'solution.mjs');
    let solutionContent = String(task.inputs.solutionContent || '');
    let testFile = String(task.inputs.testFile || 'test_solution.mjs');
    let testContent = String(task.inputs.testContent || '');
    let rawCmd = String(task.inputs.command || `node --test ${testFile}`);

    if (task.inputs.codeGenerationMode === 'model') {
      try {
        const modelPlan = await synthesizeSolutionWithModel(task.goal || task.title, {
          mode: 'model',
          requireModel: true,
          provider: (task.inputs.modelOptions as any)?.provider,
          apiKey: (task.inputs.modelOptions as any)?.apiKey,
          endpoint: (task.inputs.modelOptions as any)?.endpoint,
        });
        solutionContent = modelPlan.solution;
        testContent = modelPlan.testCode;
        rawCmd = modelPlan.command;
        solutionFile = modelPlan.solutionFile || solutionFile;
        testFile = modelPlan.testFile || testFile;
      } catch (err: unknown) {
        return updateAgentTask(task.id, {
          status: 'failed',
          error: `Model-driven solution synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
        })!;
      }
    }

    // Write synthesized solution and test files directly into task workspace
    if (solutionContent) {
      await fs.writeFile(path.join(taskWorkspaceDir, solutionFile), solutionContent, 'utf8');
    }
    if (testContent) {
      await fs.writeFile(path.join(taskWorkspaceDir, testFile), testContent, 'utf8');
    }

    // Step 1: Human-in-the-Loop Server Approval Check
    const approvalId = task.approvalId;

    if (!approvalId) {
      // Create pending approval record awaiting explicit human authorization
      const appr = createApproval({
        agentId: 'agent-cipher',
        agentName: 'Cipher',
        type: 'run_command',
        title: `Authorize Sandbox Test: ${rawCmd.slice(0, 40)}`,
        description: `Mission task "${task.title}" requires shell execution of automated test suite in sandbox.`,
        payload: { command: rawCmd, taskId: task.id, workspace: taskWorkspaceDir },
      });

      updateAgentTask(task.id, {
        status: 'blocked',
        approvalId: appr.id,
      });

      addAgentTaskObservation(task.id, {
        tool: 'request_command_execution',
        input: { command: rawCmd },
        output: `Approval request created (${appr.id}). Awaiting human authorization via Review Card before execution.`,
        status: 'warning',
      });

      recordEvidence({
        missionId: task.missionId,
        taskId: task.id,
        agentId: 'agent-cipher',
        agentName: 'Cipher',
        actionType: 'human_approval',
        summary: `Cipher requested human approval (${appr.id}) to execute "${rawCmd}"`,
        details: { approvalId: appr.id, command: rawCmd, status: 'pending' },
        status: 'blocked',
      });

      return getAgentTaskById(task.id)!;
    }

    // Check existing approval status
    const appr = getApprovalById(approvalId);
    if (!appr) {
      return updateAgentTask(task.id, {
        status: 'failed',
        error: `Approval record ${approvalId} not found.`,
      })!;
    }

    if (appr.status === 'declined') {
      recordEvidence({
        missionId: task.missionId,
        taskId: task.id,
        agentId: 'agent-cipher',
        agentName: 'Cipher',
        actionType: 'human_approval',
        summary: `Human reviewer declined command execution for task ${task.id}`,
        details: { approvalId, reason: appr.decisionReason },
        status: 'failed',
      });

      return updateAgentTask(task.id, {
        status: 'failed',
        error: `Command execution declined by human reviewer: ${appr.decisionReason || 'Declined'}`,
      })!;
    }

    if (appr.status === 'pending') {
      // Still awaiting human decision!
      addAgentTaskObservation(task.id, {
        tool: 'request_command_execution',
        input: { command: rawCmd },
        output: `Awaiting human review for approval ${approvalId}. Execution paused.`,
        status: 'warning',
      });
      return updateAgentTask(task.id, { status: 'blocked' })!;
    }

    // At this point, appr.status is 'approved'!
    // Consume approval with single-use token
    const consumption = verifyAndConsumeApproval(approvalId, appr.singleUseToken, rawCmd, 'agent-cipher');
    if (!consumption.authorized) {
      return updateAgentTask(task.id, {
        status: 'failed',
        error: `Sandbox execution denied: ${consumption.error}`,
      })!;
    }

    updateAgentTask(task.id, { status: 'in_progress' });

    // Step 2: Isolated Execution through Resource-Limited Sandbox Runtime with Action-Bound Ticket
    const sandboxResult = await executeSandboxedCommand({
      agentId: 'agent-cipher',
      command: rawCmd,
      taskId: task.id,
      approvalId,
      authorizationType: 'human_approval',
      timeoutMs: 15000,
      maxBufferBytes: 1024 * 512,
      virtualFiles: [
        { name: solutionFile, content: solutionContent },
        { name: testFile, content: testContent },
      ],
    });

    const stdout = (sandboxResult.stdout || '').trim();
    const stderr = (sandboxResult.stderr || '').trim();
    const exitCode = sandboxResult.exitCode;
    const testVerification = verifyStructuredTestOutput(stdout, stderr, exitCode);
    const testPassed = testVerification.verified;

    addAgentTaskObservation(task.id, {
      tool: 'request_command_execution',
      input: { command: rawCmd },
      output: (stdout || stderr || '[Success]').slice(0, 500),
      status: testPassed ? 'success' : 'error',
    });

    recordEvidence({
      missionId: task.missionId,
      taskId: task.id,
      agentId: 'agent-cipher',
      agentName: 'Cipher',
      actionType: 'shell_exec',
      summary: `Cipher executed "${rawCmd}" in isolated sandbox (exit code ${exitCode}, tests passed: ${testPassed}, passed: ${testVerification.passedTests}/${testVerification.totalTests})`,
      details: {
        output: (stdout || stderr || '[No Output]').slice(0, 1000),
        exitCode,
        testsPassed: testPassed,
        testVerification,
        artifacts: [solutionFile, testFile],
      },
      status: testPassed ? 'success' : 'failed',
    });

    verifyAgentTask(task.id, {
      verified: testPassed,
      method: 'structured_test_runner',
      details: testVerification.details,
    });

    return updateAgentTask(task.id, {
      status: testPassed ? 'completed' : 'failed',
      outputs: {
        command: rawCmd,
        exitCode,
        stdout: stdout.slice(0, 1000),
        testPassed,
        artifacts: [solutionFile, testFile],
      },
      error: testPassed ? undefined : `Test execution failed with exit code ${exitCode}`,
    })!;
  }

  return task;
}

/**
 * Ticks an active mission:
 * Finds pending tasks whose dependencies are met, executes them,
 * and updates milestone and mission status.
 * Enforces atomic SQLite database leases and fencing tokens across all execution paths.
 */
export async function tickMission(
  missionId: string,
  actorId: string = 'nook-orchestrator',
  leaseDurationMs: number = 30000
): Promise<DbMission & { leaseBusy?: boolean; fencingToken?: number }> {
  const mission = getMissionById(missionId);
  if (!mission || mission.status === 'completed' || mission.status === 'cancelled') {
    return mission!;
  }

  // Enforce atomic SQLite lease to prevent concurrent stepping across workers or API calls
  const leaseResource = `mission:${missionId}`;
  const lease = acquireWorkerLease(leaseResource, actorId, leaseDurationMs);
  if (!lease.acquired) {
    return {
      ...mission,
      leaseBusy: true,
    };
  }

  // Start periodic heartbeat renewal while holding lease
  const heartbeatTimer = setInterval(() => {
    renewWorkerLeaseHeartbeat(leaseResource, actorId, lease.fencingToken, leaseDurationMs);
  }, Math.max(3000, Math.floor(leaseDurationMs / 3)));

  try {
    // Validate lease before state transitions
    const isLeaseValid = validateWorkerLease(leaseResource, actorId, lease.fencingToken);
    if (!isLeaseValid) {
      throw new Error(`Worker lease invalidated for mission ${missionId} by superseding token`);
    }

    const initialCommit = commitMissionStateWithFencing(missionId, actorId, lease.fencingToken, 'active');
    if (!initialCommit.committed) {
      throw new Error(`Fencing violation: ${initialCommit.error}`);
    }

    const tasks = listTasksForMission(missionId);

    for (const task of tasks) {
      // If pending, or blocked waiting on an approval that may now be decided
      if (task.status === 'pending' || (task.status === 'blocked' && task.approvalId)) {
        await executeTaskStep(task);
        break; // Execute one task step per tick for deterministic progression
      }
    }

    // Refresh tasks after step
    const updatedTasks = listTasksForMission(missionId);
    const allCompleted = updatedTasks.every((t) => t.status === 'completed');
    const anyFailed = updatedTasks.some((t) => t.status === 'failed');
    const anyBlocked = updatedTasks.some((t) => t.status === 'blocked');

    if (allCompleted) {
      const allVerified = updatedTasks.every((t) => t.verification?.verified !== false);
      const commitRes = commitMissionStateWithFencing(missionId, actorId, lease.fencingToken, 'completed');
      if (!commitRes.committed) {
        throw new Error(`Fencing token mismatch completing mission: ${commitRes.error}`);
      }
      recordEvidence({
        missionId,
        agentId: 'agent-aura',
        agentName: 'Aura',
        actionType: 'verification',
        summary: allVerified
          ? `Mission "${mission.title}" successfully completed all milestones with full verification`
          : `Mission "${mission.title}" completed all milestones with preliminary/unverified caveats`,
        status: allVerified ? 'success' : 'warning',
      });
    } else if (anyFailed) {
      const commitRes = commitMissionStateWithFencing(missionId, actorId, lease.fencingToken, 'failed');
      if (!commitRes.committed) {
        throw new Error(`Fencing token mismatch failing mission: ${commitRes.error}`);
      }
    } else if (anyBlocked) {
      const commitRes = commitMissionStateWithFencing(missionId, actorId, lease.fencingToken, 'paused');
      if (!commitRes.committed) {
        throw new Error(`Fencing token mismatch pausing mission: ${commitRes.error}`);
      }
    }

    const finalMission = getMissionById(missionId)!;
    return {
      ...finalMission,
      leaseBusy: false,
      fencingToken: lease.fencingToken,
    };
  } finally {
    clearInterval(heartbeatTimer);
    // Release lease if mission reached terminal/paused state, or if this was an ephemeral manual API tick
    const current = getMissionById(missionId);
    if (
      actorId.startsWith('api-') ||
      !current ||
      current.status === 'completed' ||
      current.status === 'failed' ||
      current.status === 'paused' ||
      current.status === 'cancelled'
    ) {
      releaseWorkerLease(leaseResource, actorId);
    }
  }
}
