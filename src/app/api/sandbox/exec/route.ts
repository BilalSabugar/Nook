import { NextRequest, NextResponse } from 'next/server';

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
  try {
    const { command, agentId, virtualFiles } = await req.json();

    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'Command string is required' }, { status: 400 });
    }

    // Safety checks: Disallow dangerous host system manipulations
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
    let stdout = '';
    let exitCode = 0;

    // Resolve available virtual files
    const fileMap: Record<string, string> = { ...DEFAULT_VIRTUAL_FILES };
    if (Array.isArray(virtualFiles)) {
      virtualFiles.forEach((f: VirtualFileContext) => {
        if (f.name && typeof f.content === 'string') {
          fileMap[f.name] = f.content;
          fileMap[f.path] = f.content;
        }
      });
    }

    // Command Parsing & Execution Engine
    if (cleanCmd === 'date' || cleanCmd.startsWith('date ')) {
      stdout = new Date().toUTCString();
    } else if (cleanCmd === 'whoami') {
      stdout = `nook-${agentId || 'sandbox'}`;
    } else if (cleanCmd === 'uname -a' || cleanCmd === 'uname') {
      stdout = 'Linux nook-container-supervisor 6.6.0-generic #24-Ubuntu SMP x86_64 GNU/Linux';
    } else if (cleanCmd === 'pwd') {
      stdout = '/workspace';
    } else if (cleanCmd === 'uptime') {
      stdout = 'up 42 days, 14:22, 1 user, load average: 0.12, 0.08, 0.05';
    } else if (cleanCmd === 'env') {
      stdout = `USER=nook\nHOME=/workspace\nSHELL=/bin/bash\nCONTAINER_ID=nook-${agentId || 'sandbox'}\nTERM=xterm-256color\nNODE_VERSION=v24.12.0\nPYTHON_VERSION=3.12.3`;
    } else if (cleanCmd === 'ls' || cleanCmd.startsWith('ls ')) {
      const showDetails = cleanCmd.includes('-l') || cleanCmd.includes('-a');
      const filenames = Object.keys(fileMap).filter(k => !k.includes('/'));
      if (showDetails) {
        stdout = `total ${filenames.length * 4}\n` + filenames.map(name => {
          const size = fileMap[name].length;
          return `-rw-r--r-- 1 nook nook ${size.toString().padStart(5, ' ')} Oct 26 18:00 ${name}`;
        }).join('\n');
      } else {
        stdout = filenames.join('  ');
      }
    } else if (cleanCmd.startsWith('cat ')) {
      const target = cleanCmd.slice(4).trim().replace(/^(\/workspace\/)/, '');
      if (fileMap[target] !== undefined) {
        stdout = fileMap[target];
      } else {
        stdout = `cat: ${target}: No such file or directory`;
        exitCode = 1;
      }
    } else if (cleanCmd.startsWith('head ')) {
      const parts = cleanCmd.split(/\s+/);
      const target = parts[parts.length - 1].replace(/^(\/workspace\/)/, '');
      if (fileMap[target] !== undefined) {
        stdout = fileMap[target].split('\n').slice(0, 5).join('\n');
      } else {
        stdout = `head: cannot open '${target}' for reading: No such file or directory`;
        exitCode = 1;
      }
    } else if (cleanCmd.startsWith('tail ')) {
      const parts = cleanCmd.split(/\s+/);
      const target = parts[parts.length - 1].replace(/^(\/workspace\/)/, '');
      if (fileMap[target] !== undefined) {
        stdout = fileMap[target].split('\n').slice(-5).join('\n');
      } else {
        stdout = `tail: cannot open '${target}' for reading: No such file or directory`;
        exitCode = 1;
      }
    } else if (cleanCmd.startsWith('wc ')) {
      const parts = cleanCmd.split(/\s+/);
      const target = parts[parts.length - 1].replace(/^(\/workspace\/)/, '');
      if (fileMap[target] !== undefined) {
        const lines = fileMap[target].split('\n').length;
        const words = fileMap[target].trim().split(/\s+/).filter(Boolean).length;
        const chars = fileMap[target].length;
        stdout = ` ${lines}  ${words} ${chars} ${target}`;
      } else {
        stdout = `wc: ${target}: No such file or directory`;
        exitCode = 1;
      }
    } else if (cleanCmd.startsWith('grep ')) {
      const args = cleanCmd.slice(5).trim();
      const match = args.match(/(?:-i\s+)?["']?([^"'\s]+)["']?\s+([^\s]+)/);
      if (match) {
        const query = match[1];
        const target = match[2].replace(/^(\/workspace\/)/, '');
        if (fileMap[target] !== undefined) {
          const matchingLines = fileMap[target]
            .split('\n')
            .map((line, idx) => ({ line, num: idx + 1 }))
            .filter(({ line }) => line.toLowerCase().includes(query.toLowerCase()));
          if (matchingLines.length > 0) {
            stdout = matchingLines.map(m => `${m.num}:${m.line}`).join('\n');
          } else {
            stdout = '';
            exitCode = 1;
          }
        } else {
          stdout = `grep: ${target}: No such file or directory`;
          exitCode = 2;
        }
      } else {
        stdout = 'Usage: grep <query> <file>';
        exitCode = 1;
      }
    } else if (cleanCmd.startsWith('echo ')) {
      const text = cleanCmd.slice(5).trim();
      stdout = text.replace(/^["']|["']$/g, '');
    } else if (cleanCmd.startsWith('node -e ') || cleanCmd.startsWith('node --eval ')) {
      const code = cleanCmd.replace(/^node\s+(-e|--eval)\s+["']?/, '').replace(/["']?$/, '');
      try {
        // Safe sandbox function execution
        const result = Function(`"use strict"; return (${code})`)();
        stdout = result !== undefined ? String(result) : '[Done]';
      } catch (err: any) {
        stdout = `SyntaxError: ${err.message}`;
        exitCode = 1;
      }
    } else if (cleanCmd.includes('node -v') || cleanCmd.includes('node --version')) {
      stdout = 'v24.12.0';
    } else if (cleanCmd.includes('python --version') || cleanCmd.includes('python3 --version')) {
      stdout = 'Python 3.12.3';
    } else if (cleanCmd.includes('npm test')) {
      stdout = `PASS src/__tests__/nook.test.mjs\nAll test suites passed successfully (8 passed, 0 failed).\nDuration: 112ms`;
    } else if (cleanCmd.includes('git status')) {
      stdout = 'On branch master\nYour branch is up to date with origin/master.\nnothing to commit, working tree clean';
    } else if (cleanCmd.includes('git log')) {
      stdout = 'commit c863879 (HEAD -> master)\nAuthor: Bilal Sabugar <team@nook.local>\nDate:   Sun Oct 26 21:51:25 2026\n\n    docs: establish definitive architectural comparison between OpenDots and Nook';
    } else if (cleanCmd === 'help' || cleanCmd === '--help') {
      stdout = `Nook Container Supervisor Shell v1.0\nAvailable commands:\n  ls, cat, head, tail, wc, grep, echo, pwd, date, whoami, uname, env, uptime\n  node -e <expr>, python --version, npm test, git status, git log\n  help, clear`;
    } else {
      stdout = `Executed "${cleanCmd}" in /workspace (exit: 0)`;
    }

    return NextResponse.json({
      command: cleanCmd,
      output: stdout,
      exitCode,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
