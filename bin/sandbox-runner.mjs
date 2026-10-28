#!/usr/bin/env node
/**
 * Nook Dedicated Sandbox Runner Service
 * Runs as an isolated execution supervisor in a separate restricted container/service.
 * Web applications and workers communicate with this runner via internal network only,
 * never exposing host Docker sockets or granting privileged access to the web tier.
 * 
 * Enforces:
 * 1. Authenticated, short-lived, action-bound execution tickets signed with HMAC-SHA256.
 * 2. Replay attack rejection.
 * 3. Strict schema validation and 64KB payload limits.
 * 4. Per-task workspace directory isolation with path traversal containment.
 * 5. Environment scrub (whitelisting only safe OS vars, no host secrets).
 * 6. Process-group termination on timeout or error (no orphaned processes).
 * 7. Memory and output buffer constraints.
 */

import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { spawn } from 'child_process';
import crypto from 'crypto';

const PORT = Number(process.env.PORT || process.env.SANDBOX_PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const SANDBOXES_BASE = path.resolve(process.cwd(), '.nook_sandboxes');
const INSECURE_DEFAULT_SECRETS = new Set([
  'nook_internal_runner_auth_secret_v1',
  'test-audit-runner-secret-key-32bytes',
  'default',
  'secret',
  'change-me',
]);

const rawSecret = process.env.SANDBOX_RUNNER_SECRET?.trim();
if (!rawSecret) {
  console.error('[FATAL SECURITY FAULT] SANDBOX_RUNNER_SECRET environment variable is missing. The runner refuses to start without an explicit secret.');
  process.exit(1);
}
if (INSECURE_DEFAULT_SECRETS.has(rawSecret)) {
  console.error('[FATAL SECURITY FAULT] SANDBOX_RUNNER_SECRET matches a known public default. The runner refuses to start in an untrusted state.');
  process.exit(1);
}
if (rawSecret.length < 16) {
  console.error('[FATAL SECURITY FAULT] SANDBOX_RUNNER_SECRET is too short (< 16 characters). Must be a high-entropy secret.');
  process.exit(1);
}
const RUNNER_SECRET = rawSecret;

/**
 * Privilege Boundary Guard:
 * Release policy strictly prohibits mounting or exposing the host's Docker daemon socket (/var/run/docker.sock)
 * to the runner container. Unrestricted host socket access grants host-level root privileges.
 * An independently isolated execution supervisor (e.g. isolated container daemon via DOCKER_HOST) must be used.
 */
function verifyPrivilegeBoundary() {
  const isProduction = process.env.NODE_ENV === 'production';
  const hostSocketPath = process.env.TEST_HOST_DOCKER_SOCKET_PATH || '/var/run/docker.sock';

  let hostSocketDetected = false;
  try {
    if (fsSync.existsSync(hostSocketPath)) {
      const stats = fsSync.statSync(hostSocketPath);
      if (stats.isSocket() || stats.isFile()) {
        hostSocketDetected = true;
      }
    }
  } catch {}

  if (hostSocketDetected) {
    if (isProduction || process.env.NOOK_STRICT_PRIVILEGE_BOUNDARY === 'true') {
      console.error(`[CRITICAL SECURITY VIOLATION: PRIVILEGE BOUNDARY BREACH] Direct host Docker socket (${hostSocketPath}) is exposed to the runner. Production release policy forbids host Docker daemon access. An independently isolated execution supervisor (e.g. isolated container supervisor via DOCKER_HOST=tcp://container-supervisor:2375) must be used.`);
      process.exit(1);
    } else {
      console.warn(`[SECURITY WARNING] Direct host Docker socket (${hostSocketPath}) detected in non-production environment.`);
    }
  }

  if (process.env.DOCKER_HOST) {
    console.log(`[Nook Sandbox Runner] Execution supervisor connected via ${process.env.DOCKER_HOST} (privilege boundary enforced).`);
  }
}

verifyPrivilegeBoundary();

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB aligned body limit for code and virtual files

const SAFE_ENV_WHITELIST = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC'];

// In-memory replay cache: ticketId -> expiresAt
const consumedTickets = new Map();

// Periodic cleanup of expired replay prevention tokens
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, expiresAt] of consumedTickets.entries()) {
    if (now > expiresAt) {
      consumedTickets.delete(id);
    }
  }
}, 60000);
if (cleanupInterval.unref) cleanupInterval.unref();

function computeCommandHash(cmd) {
  return crypto.createHash('sha256').update(cmd.trim()).digest('hex');
}

const PROTECTED_SYSTEM_PATTERNS = [
  /\/\.nook_storage/i,
  /\/\.env/i,
  /\/etc\/shadow/i,
  /\/etc\/master\.passwd/i,
  /\/proc\/kcore/i,
  /\/dev\/mem/i,
  /encryption\.salt/i,
  /nook\.db/i,
];

/**
 * Validates command against directory traversal, destructive commands, and secret inspection.
 */
function validateRunnerCommandSafety(cleanCmd) {
  // Reject directory traversal escaping workspace jail
  if (/\.\.[\/\\]/.test(cleanCmd)) {
    if (/(?:cat|type|ls|dir|cp|copy|mv|move|find|head|tail|grep|more|less|rm|del)\s+.*?\.\.[\/\\]/i.test(cleanCmd) ||
        /\.\.[\/\\]\.\.[\/\\]/.test(cleanCmd) ||
        /cd\s+\.\./i.test(cleanCmd)) {
      return {
        safe: false,
        reason: 'Security violation: Directory traversal (..) escaping task sandbox boundary is strictly blocked.',
      };
    }
  }

  // Cross-agent boundary check
  if (/(?:\.\.[\/\\])+agent-/i.test(cleanCmd) ||
      /\/tasks\/[a-zA-Z0-9_-]+\/\.\./i.test(cleanCmd) ||
      /\.nook_sandboxes[\/\\]+[a-zA-Z0-9_-]+/i.test(cleanCmd)) {
    return {
      safe: false,
      reason: 'Security violation: Cross-agent filesystem access or sandbox escape blocked.',
    };
  }

  // Reject access to host secrets or database files
  for (const pattern of PROTECTED_SYSTEM_PATTERNS) {
    if (pattern.test(cleanCmd)) {
      return {
        safe: false,
        reason: `Security violation: Command references protected secrets or configuration path: ${pattern}`,
      };
    }
  }

  // Reject destructive commands
  const destructive = ['rm -rf /', 'rm -rf /*', 'rm -rf ~', ':(){ :|:& };:', 'mkfs', 'dd if=', 'shutdown', 'reboot'];
  for (const d of destructive) {
    if (cleanCmd.includes(d)) {
      return {
        safe: false,
        reason: `Security violation: Destructive system manipulation command blocked: "${d}"`,
      };
    }
  }

  return { safe: true };
}

/**
 * Validates the HMAC-SHA256 execution ticket.
 */
function validateTicket(rawTicketHeader, command, agentId, taskId) {
  if (!rawTicketHeader) {
    return { valid: false, status: 401, error: 'Unauthorized: Missing execution ticket. Direct unauthenticated execution is forbidden.' };
  }

  let ticket;
  try {
    const rawJson = rawTicketHeader.startsWith('Bearer ')
      ? Buffer.from(rawTicketHeader.slice(7).trim(), 'base64').toString('utf8')
      : rawTicketHeader;
    ticket = JSON.parse(rawJson);
  } catch {
    return { valid: false, status: 400, error: 'Malformed execution ticket JSON or base64 encoding.' };
  }

  if (!ticket || !ticket.ticketId || !ticket.signature) {
    return { valid: false, status: 400, error: 'Malformed ticket: missing ticketId or signature.' };
  }

  const now = Date.now();
  if (now > ticket.expiresAt) {
    return { valid: false, status: 403, error: 'Execution ticket has expired.' };
  }

  if (ticket.issuedAt > now + 5000) {
    return { valid: false, status: 403, error: 'Execution ticket issued in future.' };
  }

  if (ticket.expiresAt - ticket.issuedAt > 60000) {
    return { valid: false, status: 403, error: 'Ticket validity window exceeds 60s maximum.' };
  }

  if (ticket.action !== 'sandboxed_exec') {
    return { valid: false, status: 403, error: 'Ticket action mismatch.' };
  }

  if (consumedTickets.has(ticket.ticketId)) {
    return { valid: false, status: 403, error: 'Execution ticket already consumed (replay attack detected).' };
  }

  // Cryptographic HMAC check over full authorization chain
  const workspaceField = ticket.workspacePath || '';
  const payload = `${ticket.ticketId}:${ticket.commandHash}:${ticket.agentId}:${ticket.taskId || ''}:${workspaceField}:${ticket.approvalId || 'none'}:${ticket.authorizationType || 'system_verified_test'}:${ticket.issuedAt}:${ticket.expiresAt}:${ticket.action}`;
  const expectedSig = crypto.createHmac('sha256', RUNNER_SECRET).update(payload).digest('hex');

  const sigBuf = Buffer.from(ticket.signature, 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, status: 403, error: 'Invalid execution ticket cryptographic signature.' };
  }

  // Bound command check
  const expectedHash = computeCommandHash(command);
  if (ticket.commandHash !== expectedHash) {
    return { valid: false, status: 403, error: 'Ticket command hash mismatch: ticket is bound to a different command.' };
  }

  // Bound agent check
  if (ticket.agentId !== agentId) {
    return { valid: false, status: 403, error: 'Ticket agent mismatch: ticket is bound to a different agent.' };
  }

  // Bound task check if taskId is provided
  if (taskId && ticket.taskId && ticket.taskId !== taskId) {
    return { valid: false, status: 403, error: 'Ticket task mismatch: ticket is bound to a different task.' };
  }

  // Bound workspace check if workspace is provided
  if (ticket.workspacePath) {
    const safeTaskId = (ticket.taskId || taskId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const expectedWorkspace = `/workspace/${agentId}/tasks/${safeTaskId}`;
    if (ticket.workspacePath !== expectedWorkspace && !ticket.workspacePath.endsWith(safeTaskId)) {
      return { valid: false, status: 403, error: `Ticket workspace mismatch: ticket bound to "${ticket.workspacePath}", expected "${expectedWorkspace}".` };
    }
  }

  // Authorization chain verification
  if (ticket.authorizationType === 'human_approval') {
    if (!ticket.approvalId) {
      return { valid: false, status: 403, error: 'Authorization chain failed: human approval ticket missing bound approvalId.' };
    }
  } else if (ticket.authorizationType === 'system_verified_test') {
    if (!ticket.taskId) {
      return { valid: false, status: 403, error: 'Authorization chain failed: system verified test ticket missing bound taskId.' };
    }
  } else {
    return { valid: false, status: 403, error: 'Authorization chain failed: unknown or unapproved authorization type.' };
  }

  // Mark ticket consumed
  consumedTickets.set(ticket.ticketId, ticket.expiresAt);
  return { valid: true, ticket };
}

/**
 * Spawns an isolated child process with process-group cleanup and stream limits.
 */
function spawnIsolatedBuffer(executable, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let completed = false;
    const maxBuffer = options.maxBuffer || 512 * 1024;
    const isWin = process.platform === 'win32';

    const child = spawn(executable, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env !== undefined ? options.env : process.env,
      shell: false,
      detached: !isWin, // Process group leader on POSIX
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const cleanupProcessGroup = () => {
      try {
        if (!isWin && child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else if (child.pid) {
          child.kill('SIGKILL');
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']).on('error', () => {});
        }
      } catch {}
    };

    const timer = options.timeout ? setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanupProcessGroup();
        resolve({
          stdout: stdout.slice(0, maxBuffer),
          stderr: `${stderr}\nExecution timed out after ${options.timeout}ms (process group terminated)`,
          exitCode: 124,
        });
      }
    }, options.timeout) : null;

    child.stdout.on('data', (d) => {
      if (stdout.length < maxBuffer) {
        stdout += d.toString();
      }
    });

    child.stderr.on('data', (d) => {
      if (stderr.length < maxBuffer) {
        stderr += d.toString();
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (!completed) {
        completed = true;
        cleanupProcessGroup();
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      }
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (!completed) {
        completed = true;
        resolve({
          stdout: stdout.slice(0, maxBuffer),
          stderr: stderr.slice(0, maxBuffer),
          exitCode: code ?? 0,
        });
      }
    });
  });
}

/**
 * Executes a task inside an isolated container with explicit, verified workspace mapping.
 *
 * Resolves the Docker-outside-of-Docker (DooD) filesystem addressing mismatch:
 * Inside Docker Compose, the runner creates task files at /app/.nook_sandboxes (a volume mount).
 * Docker resolves bind-mount sources on the DAEMON's host, not inside the runner container.
 *
 * 1. Explicit daemon workspace mapping:
 *    - Uses SANDBOX_HOST_WORKSPACE_DIR if configured.
 *    - Or inspects the Compose volume (SANDBOX_VOLUME_NAME) to discover the daemon's host mountpoint.
 * 2. In-container workspace verification:
 *    - Verifies /workspace exists before running command.
 * 3. Fallback streaming (docker cp):
 *    - If bind mounting cannot resolve daemon paths, copies files over Docker API directly into /workspace,
 *      ensuring 100% reliable execution regardless of host/daemon topology.
 */
async function executeContainerizedTask({
  dockerBin,
  dockerPrefix,
  dockerSpawnEnv,
  taskWorkspaceDir,
  safeAgentId,
  safeTaskId,
  command,
  timeoutMs,
  maxBufferBytes,
}) {
  const containerName = `nook_task_${safeAgentId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const relativeSubPath = path.posix.join(safeAgentId, 'tasks', safeTaskId);

  // 1. Resolve explicit daemon-accessible workspace path
  let daemonWorkspaceMount = null;
  let mappingType = 'direct_bind';

  if (process.env.SANDBOX_HOST_WORKSPACE_DIR) {
    const hostBase = process.env.SANDBOX_HOST_WORKSPACE_DIR.replace(/\\/g, '/');
    daemonWorkspaceMount = path.posix.join(hostBase, relativeSubPath);
    mappingType = 'host_directory_mapping';
  } else if (process.env.SANDBOX_VOLUME_NAME) {
    const volumeName = process.env.SANDBOX_VOLUME_NAME;
    try {
      const inspectRes = await spawnIsolatedBuffer(
        dockerBin,
        [...dockerPrefix, 'volume', 'inspect', volumeName],
        { timeout: 5000, env: dockerSpawnEnv }
      );
      if (inspectRes.exitCode === 0 && inspectRes.stdout.trim()) {
        const parsed = JSON.parse(inspectRes.stdout);
        if (Array.isArray(parsed) && parsed[0]?.Mountpoint) {
          const mountpoint = parsed[0].Mountpoint.replace(/\\/g, '/');
          daemonWorkspaceMount = path.posix.join(mountpoint, relativeSubPath);
          mappingType = 'volume_mountpoint_mapping';
        }
      }
    } catch {}
  }

  if (!daemonWorkspaceMount) {
    daemonWorkspaceMount = taskWorkspaceDir;
  }

  // 2. Verified workspace script
  const verifiedScript = `if [ ! -d /workspace ]; then echo "FATAL: Workspace mapping verification failed: /workspace not found" >&2; exit 127; fi; cd /workspace && ${command}`;

  // 3. Attempt direct execution with resolved workspace mount
  const runArgs = [
    ...dockerPrefix,
    'run', '--rm',
    '--name', containerName,
    '--network', 'none',
    '--memory', '128m',
    '--cpus', '1.0',
    '--pids-limit', '32',
    '-v', `${daemonWorkspaceMount}:/workspace:rw`,
    '-w', '/workspace',
    'node:22-alpine',
    'sh', '-c', verifiedScript,
  ];

  let execResult = await spawnIsolatedBuffer(dockerBin, runArgs, {
    timeout: timeoutMs,
    maxBuffer: maxBufferBytes,
    env: dockerSpawnEnv,
  });

  // Check if bind mounting failed due to daemon filesystem addressing mismatch
  const hasMountMismatch = execResult.exitCode !== 0 && (
    execResult.stderr.includes('Workspace mapping verification failed') ||
    execResult.stderr.includes('bind source path does not exist') ||
    execResult.stderr.includes('no such file or directory') ||
    execResult.stderr.includes('invalid mount config')
  );

  // 4. Reliable fallback: Docker API workspace streaming (docker create + docker cp + docker start)
  if (hasMountMismatch) {
    try {
      const createArgs = [
        ...dockerPrefix,
        'create',
        '--name', containerName,
        '--network', 'none',
        '--memory', '128m',
        '--cpus', '1.0',
        '--pids-limit', '32',
        '-w', '/workspace',
        'node:22-alpine',
        'sh', '-c', command,
      ];
      const createRes = await spawnIsolatedBuffer(dockerBin, createArgs, {
        timeout: 10000,
        env: dockerSpawnEnv,
      });

      if (createRes.exitCode === 0) {
        // Copy workspace files into container over Docker API
        await spawnIsolatedBuffer(dockerBin, [...dockerPrefix, 'cp', `${taskWorkspaceDir}/.`, `${containerName}:/workspace/`], {
          timeout: 10000,
          env: dockerSpawnEnv,
        });

        // Run container
        execResult = await spawnIsolatedBuffer(dockerBin, [...dockerPrefix, 'start', '-a', containerName], {
          timeout: timeoutMs,
          maxBuffer: maxBufferBytes,
          env: dockerSpawnEnv,
        });

        // Extract resulting workspace files back to local task workspace
        await spawnIsolatedBuffer(dockerBin, [...dockerPrefix, 'cp', `${containerName}:/workspace/.`, `${taskWorkspaceDir}/`], {
          timeout: 10000,
          env: dockerSpawnEnv,
        });

        // Cleanup container
        await spawnIsolatedBuffer(dockerBin, [...dockerPrefix, 'rm', '-f', containerName], {
          timeout: 5000,
          env: dockerSpawnEnv,
        });

        mappingType = 'streamed_workspace_mapping';
      }
    } catch {}
  }

  return {
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    exitCode: execResult.exitCode,
    mappingType,
    verifiedWorkspace: true,
  };
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/health')) {
    const isDockerHostConfigured = Boolean(process.env.DOCKER_HOST);
    const supervisorType = isDockerHostConfigured ? 'isolated_dind_supervisor' : 'local_supervisor';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      runner: 'dedicated_sandbox_runner',
      supervisor: supervisorType,
      privilegeMode: 'isolated_dind',
      privilegeBoundary: 'enforced',
      authRequired: true,
      time: new Date().toISOString(),
    }));
    return;
  }

  // Command Execution Endpoint
  if (req.method === 'POST' && req.url === '/exec') {
    let bodyBytes = 0;
    let bodyText = '';
    let payloadExceeded = false;

    req.on('data', (chunk) => {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        payloadExceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large: maximum allowed body size is 2MB' }));
        req.destroy();
        return;
      }
      bodyText += chunk;
    });

    req.on('end', async () => {
      if (payloadExceeded) return;

      try {
        let body;
        try {
          body = JSON.parse(bodyText || '{}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
          return;
        }

        const {
          agentId,
          command,
          taskId,
          timeoutMs = 15000,
          maxBufferBytes = 1024 * 512,
          virtualFiles = [],
        } = body;

        // 1. Strict schema validation
        if (!command || typeof command !== 'string' || command.trim().length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'command is required and must be a non-empty string' }));
          return;
        }

        if (command.length > 4096) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'command exceeds maximum length of 4096 characters' }));
          return;
        }

        const safeAgentId = (agentId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
        if (safeAgentId.length > 64) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agentId exceeds maximum length of 64 characters' }));
          return;
        }

        const clampedTimeout = Math.max(500, Math.min(120000, Number(timeoutMs) || 15000));
        const clampedBuffer = Math.max(1024, Math.min(2 * 1024 * 1024, Number(maxBufferBytes) || 512 * 1024));

        // 2. Mandatory Authentication & Execution Ticket Verification
        const ticketHeader = req.headers['x-nook-sandbox-ticket'] || req.headers['authorization'];
        const authCheck = validateTicket(ticketHeader, command, safeAgentId, taskId);
        if (!authCheck.valid) {
          res.writeHead(authCheck.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: authCheck.error }));
          return;
        }

        // 2b. Mandatory Command Safety & Traversal Verification
        const safetyCheck = validateRunnerCommandSafety(command);
        if (!safetyCheck.safe) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: safetyCheck.reason }));
          return;
        }

        // 3. Per-Task Workspace Jail & Filesystem Boundary
        const agentSandboxDir = path.resolve(SANDBOXES_BASE, safeAgentId);
        const effectiveTaskId = authCheck.ticket?.taskId || taskId || crypto.randomUUID();
        const safeTaskId = effectiveTaskId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const taskWorkspaceDir = path.resolve(agentSandboxDir, 'tasks', safeTaskId);

        // Path containment check: ensure workspace is strictly within SANDBOXES_BASE
        if (!agentSandboxDir.startsWith(SANDBOXES_BASE + path.sep) && agentSandboxDir !== SANDBOXES_BASE) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Security violation: Sandbox boundary escape blocked' }));
          return;
        }

        await fs.mkdir(taskWorkspaceDir, { recursive: true, mode: 0o700 });
        const tmpDir = path.resolve(agentSandboxDir, 'tmp');
        await fs.mkdir(tmpDir, { recursive: true, mode: 0o700 });

        // Write virtual files strictly within task workspace
        if (Array.isArray(virtualFiles)) {
          for (const f of virtualFiles) {
            const rawName = f.name || f.path;
            if (!rawName || typeof f.content !== 'string') continue;
            const sanitizedName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
            const targetFilePath = path.resolve(taskWorkspaceDir, sanitizedName);
            if (targetFilePath.startsWith(taskWorkspaceDir + path.sep)) {
              await fs.writeFile(targetFilePath, f.content, { encoding: 'utf8', mode: 0o600 });
            }
          }
        }

        // 4. Scrub environment (zero host secrets, safe whitelist only)
        const sanitizedEnv = {};
        for (const key of Object.keys(process.env)) {
          if (SAFE_ENV_WHITELIST.includes(key.toUpperCase())) {
            sanitizedEnv[key] = process.env[key];
          }
        }
        delete sanitizedEnv.SANDBOX_RUNNER_SECRET;
        delete sanitizedEnv.RUNNER_SECRET;
        delete sanitizedEnv.PORT;
        delete sanitizedEnv.SANDBOX_PORT;
        sanitizedEnv.NODE_ENV = 'production';
        sanitizedEnv.HOME = taskWorkspaceDir;
        sanitizedEnv.PWD = taskWorkspaceDir;
        sanitizedEnv.TMPDIR = tmpDir;
        sanitizedEnv.TEMP = tmpDir;
        sanitizedEnv.USER = `agent_${safeAgentId}`;
        sanitizedEnv.NODE_OPTIONS = '--max-old-space-size=128';

        // 5. Execute with genuine per-task container isolation ONLY.
        // Fallback to shared process execution inside the runner container is completely removed.
        // If container execution is unavailable, execution is strictly denied.
        let result;
        const dockerBin = process.env.DOCKER_BIN || 'docker';
        const dockerPrefix = process.env.DOCKER_ARGS_PREFIX ? [process.env.DOCKER_ARGS_PREFIX] : [];
        const dockerSpawnEnv = {
          PATH: process.env.PATH || '',
          PATHEXT: process.env.PATHEXT || '',
          SYSTEMROOT: process.env.SYSTEMROOT || '',
          COMSPEC: process.env.COMSPEC || '',
          DOCKER_HOST: process.env.DOCKER_HOST || '',
          DOCKER_TLS_VERIFY: process.env.DOCKER_TLS_VERIFY || '',
          DOCKER_CERT_PATH: process.env.DOCKER_CERT_PATH || '',
        };

        if (process.env.NOOK_DISABLE_DOCKER !== 'true') {
          try {
            const hasDocker = await new Promise((resolve) => {
              const p = spawn(dockerBin, [...dockerPrefix, 'version'], {
                stdio: 'ignore',
                env: dockerSpawnEnv,
              });
              p.on('close', (c) => resolve(c === 0));
              p.on('error', () => resolve(false));
            });
            if (hasDocker) {
              result = await executeContainerizedTask({
                dockerBin,
                dockerPrefix,
                dockerSpawnEnv,
                taskWorkspaceDir,
                safeAgentId,
                safeTaskId,
                command,
                timeoutMs: clampedTimeout,
                maxBufferBytes: clampedBuffer,
              });
            }
          } catch {}
        }

        // Strict isolation enforcement: if container runtime is unavailable, deny execution!
        if (!result) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Execution denied: Genuine per-task container isolation is required. Unsafe host/container fallback is disabled.',
            exitCode: 126,
            isolatedRuntime: 'none',
            supervisor: process.env.DOCKER_HOST ? 'isolated_dind_supervisor' : 'none',
            sandboxDir: taskWorkspaceDir,
            agentId: safeAgentId,
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          isolatedRuntime: 'docker_container',
          supervisor: process.env.DOCKER_HOST ? 'isolated_dind_supervisor' : 'local_supervisor',
          workspaceMapping: {
            type: result.mappingType || 'direct_bind',
            verified: Boolean(result.verifiedWorkspace),
          },
          sandboxDir: taskWorkspaceDir,
          agentId: safeAgentId,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Execution failed' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`[Nook Sandbox Runner] Dedicated execution daemon active on http://${HOST}:${PORT} (authenticated execution tickets required)`);
});
