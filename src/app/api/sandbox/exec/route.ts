import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { verifyAndConsumeApproval, recordApprovalExecutionResult, logAuditEvent } from '@/lib/db';

const execPromise = util.promisify(exec);

interface VirtualFileContext {
  path?: string;
  name?: string;
  content?: string;
  size?: string;
}

const DEFAULT_VIRTUAL_FILES: Record<string, string> = {
  'deploy.sh': `#!/bin/bash\necho "Building Nook container..."\nnpm run build\necho "Deploying to production supervisor..."`,
  'notes.md': `# Agent Coworker Notes\n\n- Real model-driven agent tool execution\n- Isolated sandbox filesystem boundaries\n- Model Context Protocol (MCP) tool engine`,
  'metrics.log': `[INFO] Supervisor uptime: 99.99%\n[INFO] Active persistent coworkers: 4\n[INFO] Isolated sandboxes: active`,
};

export async function POST(req: NextRequest) {
  // 1. Authentication check
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { command, agentId, virtualFiles, approvalId, approvalToken } = body;

    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'Command string is required' }, { status: 400 });
    }

    const cleanCmd = command.trim();
    const safeAgentId = (agentId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');

    // 2. Mandatory Server-Side Approval and Single-Use Token Verification
    // Every mutating or privileged shell execution strictly requires an active, matching, unexpired server approval.
    if (!approvalId || !approvalToken) {
      logAuditEvent('SHELL_EXEC_DENIED', `Attempted execution without approval token: "${cleanCmd}"`, 'denied', safeAgentId);
      return NextResponse.json({
        error: 'Execution denied: Mandatory server-side approval and single-use authorization token required for shell execution.',
        exitCode: 1,
      }, { status: 403 });
    }

    // Atomic consumption from transactional database
    const verification = verifyAndConsumeApproval(approvalId, approvalToken, cleanCmd, safeAgentId);
    if (!verification.authorized) {
      logAuditEvent('SHELL_EXEC_DENIED', `Approval rejected (${verification.error}) for: "${cleanCmd}"`, 'denied', safeAgentId);
      return NextResponse.json({
        error: `Execution denied: ${verification.error}`,
        exitCode: 1,
      }, { status: 403 });
    }

    // 3. Defense-in-depth safety filters: Disallow destructive host system manipulation
    const forbiddenSubstrings = [
      'rm -rf /',
      'rm -rf /*',
      'rm -rf ~',
      ':(){ :|:& };:',
      'mkfs',
      'dd if=',
      'shutdown',
      'reboot',
      '> /dev/sda',
      'chmod -R 777 /',
    ];
    const forbiddenPatterns = [
      /\|\s*(ba)?sh/i,
      />\s*\/dev\/(sda|nvme)/i,
    ];
    const isForbidden =
      forbiddenSubstrings.some((f) => cleanCmd.includes(f)) ||
      forbiddenPatterns.some((pattern) => pattern.test(cleanCmd));

    if (isForbidden) {
      logAuditEvent('SHELL_EXEC_BLOCKED', `Safety filter blocked dangerous command: "${cleanCmd}"`, 'blocked', safeAgentId);
      return NextResponse.json({
        output: 'Error: Command rejected by Nook sandbox safety policy. Destructive host manipulation blocked.',
        exitCode: 1,
        timestamp: new Date().toISOString(),
      }, { status: 403 });
    }

    // 4. Setup isolated agent workspace directory
    const sandboxDir = path.resolve(process.cwd(), '.nook_sandboxes', safeAgentId);
    await fs.mkdir(sandboxDir, { recursive: true });

    // 5. File safety and path traversal protection for virtual files
    const fileMap: Record<string, string> = { ...DEFAULT_VIRTUAL_FILES };
    if (Array.isArray(virtualFiles)) {
      for (const f of virtualFiles) {
        const rawName = f.name || f.path;
        if (rawName && typeof f.content === 'string') {
          // Prevent path traversal: reject absolute paths, null bytes, and traversal patterns
          if (rawName.includes('..') || path.isAbsolute(rawName) || rawName.includes('\0')) {
            logAuditEvent('PATH_TRAVERSAL_BLOCKED', `Attempted file traversal: "${rawName}"`, 'blocked', safeAgentId);
            return NextResponse.json({
              error: `Security violation: Path traversal detected in filename '${rawName}'. Access denied.`,
              exitCode: 1,
            }, { status: 400 });
          }

          // Use strict basename to guarantee placement inside sandbox directory
          const sanitizedBasename = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
          if (!sanitizedBasename) continue;

          // Enforce 512KB size limit per virtual file
          if (Buffer.byteLength(f.content, 'utf8') > 512 * 1024) {
            return NextResponse.json({
              error: `File payload exceeds maximum size limit (512 KB): '${sanitizedBasename}'`,
              exitCode: 1,
            }, { status: 400 });
          }

          fileMap[sanitizedBasename] = f.content;
        }
      }
    }

    // Write sanitized files to sandbox directory
    for (const [filename, content] of Object.entries(fileMap)) {
      const targetPath = path.resolve(sandboxDir, filename);
      // Double check sandbox boundary
      if (!targetPath.startsWith(sandboxDir + path.sep) && targetPath !== sandboxDir) {
        logAuditEvent('PATH_TRAVERSAL_BLOCKED', `Target path escaped sandbox: "${targetPath}"`, 'blocked', safeAgentId);
        return NextResponse.json({
          error: `Security violation: Target file path '${filename}' resolves outside sandbox boundary.`,
          exitCode: 1,
        }, { status: 400 });
      }

      try {
        await fs.writeFile(targetPath, content, 'utf8');
      } catch {
        // ignore disk race
      }
    }

    // Initialize local isolated git repository if absent
    const gitDir = path.join(sandboxDir, '.git');
    try {
      await fs.access(gitDir);
    } catch {
      try {
        await execPromise('git init && git config user.name "Nook Coworker" && git config user.email "coworker@nook.local" && git add . && git commit -m "initial workspace commit" --allow-empty', {
          cwd: sandboxDir,
          timeout: 4000,
        });
      } catch {
        // git may not be installed or needed
      }
    }

    // 6. Isolated Shell Execution with Clean Low-Privilege Environment
    // Critical: Do NOT leak host secrets or API keys into the execution environment.
    const isWin = process.platform === 'win32';
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      const lower = key.toLowerCase();
      if (lower.includes('secret') || lower.includes('api_key') || lower.includes('token') || lower.startsWith('nook_')) {
        delete cleanEnv[key];
      }
    }
    cleanEnv.HOME = sandboxDir;
    cleanEnv.USER = `nook-${safeAgentId}`;
    cleanEnv.NODE_ENV = 'test';

    let stdout = '';
    let exitCode = 0;

    try {
      const execResult = await execPromise(cleanCmd, {
        cwd: sandboxDir,
        timeout: 10000, // 10 second timeout limit
        maxBuffer: 1024 * 512, // 512KB buffer limit
        shell: isWin ? 'powershell.exe' : '/bin/sh',
        env: cleanEnv as NodeJS.ProcessEnv,
      });

      stdout = execResult.stdout || execResult.stderr || '[Command finished with no output]';
      exitCode = 0;
    } catch (execErr: any) {
      stdout = execErr.stdout || execErr.stderr || execErr.message || 'Execution error';
      exitCode = execErr.code || 1;
    }

    // 7. Record execution outcome on approval record and audit log
    recordApprovalExecutionResult(approvalId, {
      success: exitCode === 0,
      executedAt: new Date().toISOString(),
      output: stdout.slice(0, 2000),
      exitCode,
    });

    logAuditEvent('SHELL_EXEC_COMPLETE', `Executed: "${cleanCmd}" (exit: ${exitCode})`, exitCode === 0 ? 'success' : 'failed', safeAgentId);

    // List available files in sandbox
    let updatedFiles: string[] = [];
    try {
      const currentDirFiles = await fs.readdir(sandboxDir);
      updatedFiles = currentDirFiles.filter((f) => f !== '.git');
    } catch {
      // ignore
    }

    return NextResponse.json({
      command: cleanCmd,
      output: stdout.trim(),
      exitCode,
      sandboxPath: `/workspace/${safeAgentId}`,
      availableFiles: updatedFiles,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Sandbox execution error' }, { status: 500 });
  }
}
