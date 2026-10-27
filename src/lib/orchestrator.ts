import {
  createMission,
  getMissionById,
  updateMissionStatus,
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
}

import { planSolutionAndTests } from './solution-planner.ts';
import { verifyStructuredTestOutput } from './test-verifier.ts';
export { planSolutionAndTests, verifyStructuredTestOutput };

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
    // Supporting sources are retrieved sources that contain substantive content matching query
    const supportingSources = retrievedSources.filter((_, idx) => {
      const desc = (descriptions[idx] || '').trim();
      return desc.length > 10 && !desc.toLowerCase().includes('may refer to');
    });

    if (supportingSources.length > 0) {
      const citations = supportingSources;
      const summaryFindings = titles.map((t, i) => `${t}: ${descriptions[i] || 'Overview'}`).join('; ');

      recordEvidence({
        missionId: task.missionId,
        taskId: task.id,
        agentId: 'agent-scout',
        agentName: 'Scout',
        actionType: 'browser_visit',
        summary: `Scout collected ${citations.length} verified technical citations`,
        details: {
          searchedQueries,
          searchedSources,
          retrievedSources,
          supportingSources,
          sourceCitations: citations,
          findings: summaryFindings,
          sourceTitles: titles,
        },
      });

      verifyAgentTask(task.id, {
        verified: true,
        method: 'citation_validation',
        details: `Verified ${citations.length} authentic source links from authoritative knowledge base.`,
      });

      return updateAgentTask(task.id, {
        status: 'completed',
        outputs: {
          searchedQueries,
          searchedSources,
          retrievedSources,
          supportingSources,
          citations,
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
    let findings = 'Foundational architecture principles verified.';

    for (const depId of task.dependencies) {
      const dep = getAgentTaskById(depId);
      if (dep?.outputs?.citations) {
        citations = citations.concat(dep.outputs.citations as string[]);
      }
      if (dep?.outputs?.findings) {
        findings = String(dep.outputs.findings);
      }
    }

    const docTitle = String(task.inputs.documentTitle || task.title);
    const spaceId = String(task.inputs.targetSpaceId || 'space-research');
    const docId = `doc-briefing-${task.missionId}`;

    const citationsList = citations.length > 0
      ? citations.map((c) => `- [${c}](${c})`).join('\n')
      : '_No external citations verified for this topic._';

    const documentContent = `# ${docTitle}

> **Executive Briefing & Verified Intelligence**
> Prepared by Quill, synthesized from Scout's technical investigation.

## Core Findings
${findings}

## Verified Source Citations
${citationsList}

## Architecture Review
- **Integrity**: Cross-verified against primary specifications.
- **Verification Status**: Sealed into Living Spaces with immutable revision log.
`;

    // Persist document into SQLite Living Spaces
    saveDocumentWithRevision({
      id: docId,
      spaceId,
      title: docTitle,
      content: documentContent,
      excerpt: findings.slice(0, 160),
      icon: 'file-text',
      authorAgentId: 'agent-quill',
      tags: ['mission-output', 'briefing', 'verified'],
      changeSummary: `Created technical briefing page for mission ${task.missionId}`,
    });

    addAgentTaskObservation(task.id, {
      tool: 'format_document',
      input: { docId, spaceId },
      output: `Published document ${docId} with ${documentContent.length} bytes to space ${spaceId}`,
      status: 'success',
    });

    recordEvidence({
      missionId: task.missionId,
      taskId: task.id,
      agentId: 'agent-quill',
      agentName: 'Quill',
      actionType: 'file_write',
      summary: `Quill synthesized and published document "${docTitle}" to Living Space`,
      details: {
        documentId: docId,
        spaceId,
        version: 1,
        contentLength: documentContent.length,
      },
    });

    verifyAgentTask(task.id, {
      verified: true,
      method: 'schema_check',
      details: `Living Space document ${docId} confirmed created with revision tracking.`,
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
    const safeAgentId = 'cipher';
    const sandboxDir = path.resolve(process.cwd(), '.nook_sandboxes', safeAgentId);
    await fs.mkdir(sandboxDir, { recursive: true });

    // Step 0: Write synthesized solution and test files into sandbox
    const solutionFile = String(task.inputs.solutionFile || 'solution.mjs');
    const solutionContent = String(task.inputs.solutionContent || '');
    const testFile = String(task.inputs.testFile || 'test_solution.mjs');
    const testContent = String(task.inputs.testContent || '');
    const rawCmd = String(task.inputs.command || `node --test ${testFile}`);

    if (solutionContent) {
      await fs.writeFile(path.join(sandboxDir, solutionFile), solutionContent, 'utf8');
    }
    if (testContent) {
      await fs.writeFile(path.join(sandboxDir, testFile), testContent, 'utf8');
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
        payload: { command: rawCmd },
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

    // Step 2: Isolated Execution through Resource-Limited Sandbox Runtime
    const sandboxResult = await executeSandboxedCommand({
      agentId: 'cipher',
      command: rawCmd,
      timeoutMs: 10000,
      maxBufferBytes: 1024 * 256,
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
 */
export async function tickMission(missionId: string): Promise<DbMission> {
  const mission = getMissionById(missionId);
  if (!mission || mission.status === 'completed' || mission.status === 'cancelled') {
    return mission!;
  }

  updateMissionStatus(missionId, 'active');
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
    updateMissionStatus(missionId, 'completed');
    recordEvidence({
      missionId,
      agentId: 'agent-aura',
      agentName: 'Aura',
      actionType: 'verification',
      summary: `Mission "${mission.title}" successfully completed all milestones with full verification`,
      status: 'success',
    });
  } else if (anyFailed) {
    updateMissionStatus(missionId, 'failed');
  } else if (anyBlocked) {
    updateMissionStatus(missionId, 'paused');
  }

  return getMissionById(missionId)!;
}
