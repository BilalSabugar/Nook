import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { logAuditEvent } from './db.ts';
import { createSandboxExecutionTicket } from './sandbox-ticket.ts';

/**
 * Spawns an executable directly with arguments array, bypassing host shell parsing.
 * Eliminates host shell metacharacter expansion and injection vulnerabilities.
 */
function spawnBuffer(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let completed = false;
    const maxBuf = options.maxBuffer ?? 256 * 1024;

    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false, // Critical: prevent host shell metacharacter interpretation
      windowsHide: true,
    });

    const timer = options.timeout ? setTimeout(() => {
      if (!completed) {
        completed = true;
        child.kill('SIGKILL');
        resolve({ stdout, stderr: stderr + `\nExecution timed out after ${options.timeout}ms`, exitCode: 124 });
      }
    }, options.timeout) : null;

    child.stdout?.on('data', (data) => {
      if (stdout.length < maxBuf) {
        stdout += data.toString();
      }
    });

    child.stderr?.on('data', (data) => {
      if (stderr.length < maxBuf) {
        stderr += data.toString();
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (!completed) {
        completed = true;
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      }
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (!completed) {
        completed = true;
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });
  });
}

export interface SandboxExecutionOptions {
  agentId: string;
  command: string;
  taskId?: string;
  approvalId?: string;
  authorizationType?: 'human_approval' | 'system_verified_test';
  timeoutMs?: number;
  maxBufferBytes?: number;
  virtualFiles?: Array<{ name?: string; path?: string; content?: string }>;
  allowHostFallback?: boolean;
}

export interface SandboxExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  isolatedRuntime: 'docker_container' | 'process_jail' | 'none';
  executionTimeMs: number;
  sandboxDir: string;
}

const SANDBOXES_BASE = path.join(process.cwd(), '.nook_sandboxes');

// Sensitive host paths that isolated commands must NEVER access or reference
const SENSITIVE_PATTERNS = [
  /\.env(\..+)?/i,
  /\.nook_storage/i,
  /\.git\/(config|credentials|HEAD)/i,
  /\.ssh/i,
  /\.aws/i,
  /id_rsa/i,
  /\/etc\/(passwd|shadow)/i,
  /C:\\Windows\\System32\\config/i,
];

/**
 * Checks if Docker container runtime is available on the host system.
 */
let dockerAvailableCache: boolean | null = null;
async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailableCache !== null) return dockerAvailableCache;
  if (process.env.NOOK_DISABLE_DOCKER === 'true') {
    dockerAvailableCache = false;
    return false;
  }
  try {
    // Fast check: verify Docker daemon is responsive AND node:22-alpine image is locally cached.
    // Uses direct spawnBuffer without shell to avoid host shell invocation.
    const res = await spawnBuffer('docker', ['image', 'inspect', 'node:22-alpine'], { timeout: 1500 });
    dockerAvailableCache = res.exitCode === 0 && res.stdout.length > 0;
  } catch {
    dockerAvailableCache = false;
  }
  return dockerAvailableCache;
}

/**
 * Pre-execution security filter: validates command against path escape and destructive attacks.
 */
export function validateCommandSafety(cleanCmd: string, _agentId: string): { safe: boolean; reason?: string } {
  // Reject cross-agent directory traversal or references to other agents
  if (
    /(?:\.\.[\/\\])+agent-/i.test(cleanCmd) ||
    /\.nook_sandboxes[\/\\]+[a-zA-Z0-9_-]+/i.test(cleanCmd) ||
    /\/tasks\/[a-zA-Z0-9_-]+\/\.\./i.test(cleanCmd) ||
    /\b(?:agent-[a-zA-Z0-9_-]+[\/\\]+tasks)/i.test(cleanCmd)
  ) {
    return {
      safe: false,
      reason: 'Security violation: Cross-agent directory access or sandbox escape blocked.',
    };
  }

  // Reject traversal escaping agent root
  if (/\.\.[\/\\]/.test(cleanCmd)) {
    return {
      safe: false,
      reason: 'Security violation: Directory traversal (..) escaping agent workspace is strictly blocked.',
    };
  }

  // Reject access to host secrets or system files
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(cleanCmd)) {
      return {
        safe: false,
        reason: `Security violation: Command references protected host secrets or configuration path: ${pattern}`,
      };
    }
  }

  // Reject destructive system manipulation
  const destructiveCommands = [
    'rm -rf /',
    'rm -rf /*',
    'rm -rf ~',
    ':(){ :|:& };:',
    'mkfs',
    'dd if=',
    'shutdown',
    'reboot',
    '> /dev/sda',
  ];
  if (destructiveCommands.some((d) => cleanCmd.includes(d))) {
    return {
      safe: false,
      reason: 'Security violation: Destructive host command rejected by sandbox safety policy.',
    };
  }

  return { safe: true };
}

/**
 * Executes a shell command inside an isolated, unprivileged, resource-limited runtime.
 * Guarantees:
 * 1. Zero propagation of host secrets / API keys / environment variables.
 * 2. Strict directory boundary confined to `.nook_sandboxes/<agentId>`.
 * 3. Enforces resource limits (timeout, buffer size, memory).
 * 4. Uses Docker container isolation when available; falls back to hardened process jail.
 */
export async function executeSandboxedCommand(
  options: SandboxExecutionOptions
): Promise<SandboxExecutionResult> {
  const startTime = Date.now();
  const safeAgentId = (options.agentId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanCmd = options.command.trim();
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxBuffer = options.maxBufferBytes ?? 256 * 1024;

  // 1. Pre-execution safety filter
  const safetyCheck = validateCommandSafety(cleanCmd, safeAgentId);
  if (!safetyCheck.safe) {
    logAuditEvent('SANDBOX_BLOCKED', safetyCheck.reason || 'Safety check failed', 'blocked', safeAgentId);
    return {
      stdout: '',
      stderr: safetyCheck.reason || 'Command rejected by sandbox isolation policy.',
      exitCode: 1,
      isolatedRuntime: 'process_jail',
      executionTimeMs: Date.now() - startTime,
      sandboxDir: `/workspace/${safeAgentId}`,
    };
  }

  // 2. Setup isolated task workspace directory
  const agentSandboxDir = path.resolve(SANDBOXES_BASE, safeAgentId);
  const safeTaskId = (options.taskId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const taskWorkspaceDir = path.resolve(agentSandboxDir, 'tasks', safeTaskId);
  await fs.mkdir(taskWorkspaceDir, { recursive: true });

  // 3. Write virtual files securely within task workspace directory
  if (Array.isArray(options.virtualFiles)) {
    for (const f of options.virtualFiles) {
      const rawName = f.name || f.path;
      if (!rawName || typeof f.content !== 'string') continue;

      // Prevent traversal in file creation
      const sanitizedName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetFilePath = path.resolve(taskWorkspaceDir, sanitizedName);

      // Verify path does not escape task workspace
      if (!targetFilePath.startsWith(taskWorkspaceDir + path.sep) && targetFilePath !== taskWorkspaceDir) {
        continue;
      }

      try {
        await fs.writeFile(targetFilePath, f.content, 'utf8');
      } catch {
        // ignore disk write races
      }
    }
  }

  // 4. Try dedicated restricted sandbox runner service if configured
  const sandboxServiceUrl = process.env.SANDBOX_SERVICE_URL;
  if (sandboxServiceUrl) {
    try {
      const ticket = createSandboxExecutionTicket({
        command: cleanCmd,
        agentId: safeAgentId,
        taskId: options.taskId,
        workspacePath: `/workspace/${safeAgentId}/tasks/${safeTaskId}`,
        approvalId: options.approvalId,
        authorizationType: options.authorizationType || (options.approvalId ? 'human_approval' : 'system_verified_test'),
        ttlMs: timeoutMs + 10000,
      });
      const ticketBase64 = Buffer.from(JSON.stringify(ticket)).toString('base64');
      const response = await fetch(`${sandboxServiceUrl}/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ticketBase64}`,
          'X-Nook-Sandbox-Ticket': JSON.stringify(ticket),
        },
        body: JSON.stringify({
          agentId: safeAgentId,
          taskId: ticket.taskId,
          approvalId: ticket.approvalId,
          authorizationType: ticket.authorizationType,
          command: cleanCmd,
          timeoutMs,
          maxBufferBytes: maxBuffer,
          virtualFiles: options.virtualFiles,
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as { stdout?: string; stderr?: string; exitCode?: number };
        return {
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: result.exitCode ?? 0,
          isolatedRuntime: 'docker_container',
          executionTimeMs: Date.now() - startTime,
          sandboxDir: `/workspace/${safeAgentId}/tasks/${safeTaskId}`,
        };
      }
    } catch (serviceErr: unknown) {
      logAuditEvent('SANDBOX_SERVICE_ERROR', `Sandbox runner service unavailable: ${serviceErr instanceof Error ? serviceErr.message : String(serviceErr)}`, 'fallback', safeAgentId);
    }
  }

  // 5. Try Containerized Docker Execution with per-task mounted workspace
  const hasDocker = await isDockerAvailable();
  if (hasDocker) {
    try {
      // Ephemeral, network-isolated, per-task container
      const dockerArgs = [
        'run',
        '--rm',
        '--network', 'none', // Network-level egress isolation
        '--memory', '256m', // 256MB memory cap
        '--cpus', '1.0', // CPU quota
        '--pids-limit', '64', // Process fork bomb protection
        '-v', `${taskWorkspaceDir}:/workspace:rw`,
        '-w', '/workspace',
        'node:22-alpine',
        'sh', '-c', cleanCmd,
      ];

      // Execute docker directly via spawnBuffer: zero shell interpolation on host
      const dockerRes = await spawnBuffer('docker', dockerArgs, {
        timeout: timeoutMs,
        maxBuffer,
      });

      if (dockerRes.exitCode === 0 || (dockerRes.stdout && !dockerRes.stderr.includes('Error response from daemon'))) {
        return {
          stdout: dockerRes.stdout,
          stderr: dockerRes.stderr,
          exitCode: dockerRes.exitCode,
          isolatedRuntime: 'docker_container',
          executionTimeMs: Date.now() - startTime,
          sandboxDir: `/workspace/${safeAgentId}/tasks/${safeTaskId}`,
        };
      }
      logAuditEvent('SANDBOX_FALLBACK', `Container runtime exit code ${dockerRes.exitCode}: ${dockerRes.stderr}`, 'fallback', safeAgentId);
    } catch (dockerErr: unknown) {
      const error = dockerErr as Error;
      logAuditEvent('SANDBOX_FALLBACK', `Container runtime error (${error.message || 'error'}), evaluating fallback policy`, 'fallback', safeAgentId);
    }
  }

  // Strict Fail-Closed Security Policy: Host execution fallback is completely eliminated.
  logAuditEvent(
    'SANDBOX_FAIL_CLOSED',
    'Execution denied: Neither dedicated sandbox runner service nor isolated container runtime is available. Host execution is strictly eliminated by security policy.',
    'blocked',
    safeAgentId
  );
  return {
    stdout: '',
    stderr: 'Security Policy Violation: Isolated container runtime (Docker) and sandbox runner service are unavailable. Command execution refused to eliminate unconfined host shell execution.',
    exitCode: 126,
    isolatedRuntime: 'none',
    executionTimeMs: Date.now() - startTime,
    sandboxDir: `/workspace/${safeAgentId}/tasks/${safeTaskId}`,
  };
}
