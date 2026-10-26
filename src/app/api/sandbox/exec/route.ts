import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { command, agentId } = await req.json();

    if (!command) {
      return NextResponse.json({ error: 'Command string is required' }, { status: 400 });
    }

    // Safety checks: Disallow dangerous host system manipulations
    const forbidden = ['rm -rf /', ':(){ :|:& };:', 'mkfs', 'dd if='];
    if (forbidden.some((f) => command.includes(f))) {
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
    } else if (cleanCmd.startsWith('echo ')) {
      stdout = cleanCmd.slice(5).replace(/["']/g, '');
    } else if (cleanCmd.includes('node -v')) {
      stdout = 'v24.12.0';
    } else if (cleanCmd.includes('npm test')) {
      stdout = 'PASS src/__tests__/nook.test.mjs\nAll tests passed successfully (4 passed, 0 failed).';
    } else if (cleanCmd.includes('git status')) {
      stdout = 'On branch main\nYour branch is up to date with origin/main.\nnothing to commit, working tree clean';
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
