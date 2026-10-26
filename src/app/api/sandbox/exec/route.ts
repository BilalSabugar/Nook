import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';

const execPromise = util.promisify(exec);

interface VirtualFileContext {
  path: string;
  name: string;
  content: string;
  size?: string;
  updatedAt?: string;
}

const DEFAULT_VIRTUAL_FILES: Record<string, string> = {
  'deploy.sh': `#!/bin/bash\necho "Building Nook container..."\nnpm run build\necho "Deploying to production supervisor..."`,
  'notes.md': `# Agent Coworker Notes\n\n- Completed OpenDots architecture review\n- Hardened sandbox execution safeguards\n- Integrated Model Context Protocol (MCP)`,
  'metrics.log': `[INFO] Supervisor uptime: 99.98%\n[INFO] Active persistent coworkers: 4\n[INFO] Memory usage: 142 MB / 512 MB`,
};

export async function POST(req: NextRequest) {
  // 1. Authorization check
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const { command, agentId, virtualFiles, approvalId, approvalToken } = await req.json();

    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'Command string is required' }, { status: 400 });
    }

    // 2. Server-side approval verification if command was submitted under approval requirement
    if (approvalId) {
      const approvalsPath = path.join(process.cwd(), '.nook_storage', 'approvals.json');
      let approvals: Record<string, any> = {};
      try {
        const raw = await fs.readFile(approvalsPath, 'utf8');
        approvals = JSON.parse(raw);
      } catch {}

      const record = approvals[approvalId];
      if (!record) {
        return NextResponse.json({
          error: `Execution denied: Server approval record ${approvalId} not found.`,
          exitCode: 1,
        }, { status: 403 });
      }

      if (record.status !== 'approved') {
        return NextResponse.json({
          error: `Execution denied: Server approval is '${record.status}'. Action requires an 'approved' state.`,
          exitCode: 1,
        }, { status: 403 });
      }

      if (approvalToken && record.singleUseToken && record.singleUseToken !== approvalToken) {
        return NextResponse.json({
          error: 'Execution denied: Invalid single-use approval authorization token.',
          exitCode: 1,
        }, { status: 403 });
      }

      if (Date.now() > Date.parse(record.expiresAt)) {
        record.status = 'declined';
        await fs.writeFile(approvalsPath, JSON.stringify(approvals, null, 2), 'utf8');
        return NextResponse.json({
          error: 'Execution denied: Authorization approval has expired.',
          exitCode: 1,
        }, { status: 403 });
      }

      // Mark single-use token as consumed
      record.status = 'consumed';
      await fs.writeFile(approvalsPath, JSON.stringify(approvals, null, 2), 'utf8');
    }

    // 2. Strict Safety policy: Disallow destructive host system manipulations
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
      forbiddenSubstrings.some((f) => command.includes(f)) ||
      forbiddenPatterns.some((pattern) => pattern.test(command));

    if (isForbidden) {
      return NextResponse.json({
        output: `Error: Command rejected by Nook sandbox safety policy. Potentially destructive operation blocked.`,
        exitCode: 1,
        timestamp: new Date().toISOString(),
      }, { status: 403 });
    }

    const cleanCmd = command.trim();

    // 3. Setup real isolated sandbox directory on the server
    const safeAgentId = (agentId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const sandboxDir = path.join(process.cwd(), '.nook_sandboxes', safeAgentId);
    await fs.mkdir(sandboxDir, { recursive: true });

    // 4. Synchronize virtual files onto the sandbox disk
    const fileMap: Record<string, string> = { ...DEFAULT_VIRTUAL_FILES };
    if (Array.isArray(virtualFiles)) {
      virtualFiles.forEach((f: VirtualFileContext) => {
        if (f.name && typeof f.content === 'string') {
          fileMap[f.name] = f.content;
        }
      });
    }

    for (const [filename, content] of Object.entries(fileMap)) {
      const filePath = path.join(sandboxDir, filename);
      try {
        await fs.writeFile(filePath, content, 'utf8');
      } catch {
        // ignore disk write race
      }
    }

    // Initialize local git repository in sandbox if not present
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

    // 5. Real Shell Execution via OS child process
    let stdout = '';
    let exitCode = 0;

    // Cross-platform shell execution
    const isWin = process.platform === 'win32';
    const shellCommand = cleanCmd;

    try {
      const execResult = await execPromise(shellCommand, {
        cwd: sandboxDir,
        timeout: 6000,
        maxBuffer: 1024 * 512,
        shell: isWin ? 'powershell.exe' : '/bin/sh',
        env: {
          PATH: process.env.PATH,
          USER: `nook-${safeAgentId}`,
          HOME: sandboxDir,
          NODE_ENV: 'development',
        },
      });

      stdout = execResult.stdout || execResult.stderr || '[Command finished with no output]';
      exitCode = 0;
    } catch (execErr: any) {
      stdout = execErr.stdout || execErr.stderr || execErr.message || 'Execution error';
      exitCode = execErr.code || 1;
    }

    // Check if any files were created/modified in sandbox
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
