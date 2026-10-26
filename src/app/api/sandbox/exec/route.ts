import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { command, agentId } = await req.json();

    if (!command) {
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
        output: `Error: Command rejected by Nook sandbox safety policy.`,
        exitCode: 1,
        timestamp: new Date().toISOString(),
      }, { status: 403 });
    }

    // Handle common sandbox simulation commands
    const cleanCmd = command.trim();
    let stdout = `Executed "${cleanCmd}".`;
    let exitCode = 0;

    if (cleanCmd === 'date' || cleanCmd.startsWith('date')) {
      stdout = new Date().toUTCString();
    } else if (cleanCmd === 'whoami') {
      stdout = `nook-${agentId || 'sandbox'}`;
    } else if (cleanCmd === 'uname -a') {
      stdout = 'Linux nook-container-supervisor 6.6.0-generic #24-Ubuntu SMP x86_64 GNU/Linux';
    } else if (cleanCmd === 'pwd') {
      stdout = '/workspace';
    } else if (cleanCmd === 'ls' || cleanCmd === 'ls -la') {
      stdout = 'total 32\ndrwxr-xr-x 2 nook nook 4096 Oct 26 18:00 .\ndrwxr-xr-x 4 root root 4096 Oct 26 17:30 ..\n-rw-r--r-- 1 nook nook  520 Oct 26 18:05 deploy.sh\n-rw-r--r-- 1 nook nook 1240 Oct 26 18:10 notes.md\n-rw-r--r-- 1 nook nook  840 Oct 26 18:12 metrics.log';
    } else if (cleanCmd.startsWith('echo ')) {
      stdout = cleanCmd.slice(5).replace(/["']/g, '');
    } else if (cleanCmd.includes('node -v')) {
      stdout = 'v24.12.0';
    } else if (cleanCmd.includes('python --version') || cleanCmd.includes('python3 --version')) {
      stdout = 'Python 3.12.3';
    } else if (cleanCmd.includes('npm test')) {
      stdout = 'PASS src/__tests__/nook.test.mjs\nAll tests passed successfully (7 passed, 0 failed).';
    } else if (cleanCmd.includes('git status')) {
      stdout = 'On branch master\nYour branch is up to date with origin/master.\nnothing to commit, working tree clean';
    } else if (cleanCmd.includes('git log')) {
      stdout = 'commit 2dddda0 (HEAD -> master)\nAuthor: Nook Team <team@nook.local>\nDate:   Sun Oct 26 18:28:00 2026\n\n    docs: add comprehensive open-source documentation';
    } else if (cleanCmd === 'env') {
      stdout = 'USER=nook\nHOME=/workspace\nSHELL=/bin/bash\nCONTAINER_ID=nook-sandbox-supervisor\nTERM=xterm-256color';
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
