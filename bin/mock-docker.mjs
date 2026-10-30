#!/usr/bin/env node
/**
 * Mock Docker CLI for testing containerized sandbox execution on hosts
 * without a running Docker daemon (e.g. Windows unit tests).
 * Conforms to the `docker run` interface expected by sandbox-runner.mjs.
 */
import { spawn } from 'child_process';
import path from 'path';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === 'version') {
  process.stdout.write('Docker version 27.0.0-mock, build abcdef0\n');
  process.exit(0);
}

if (args[0] === 'volume' && args[1] === 'inspect') {
  const volName = args[2] || 'nook_sandboxes';
  process.stdout.write(JSON.stringify([{
    Name: volName,
    Mountpoint: path.resolve(process.cwd(), '.nook_sandboxes'),
  }]) + '\n');
  process.exit(0);
}

if (args[0] === 'run') {
  let workspaceDir = process.cwd();
  let cmdToRun = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-v' && args[i + 1]) {
      const mount = args[i + 1];
      const colonIdx = mount.indexOf(':/workspace');
      if (colonIdx !== -1) {
        workspaceDir = mount.substring(0, colonIdx);
      }
    }
    if (args[i] === '-c' && args[i + 1]) {
      cmdToRun = args.slice(i + 1).join(' ');
      break;
    }
  }

  if (!cmdToRun) {
    process.stderr.write('mock-docker: No command specified\n');
    process.exit(1);
  }

  // Strip POSIX workspace verification prefix if present for mock runner on Windows
  const cdPrefix = 'cd /workspace && ';
  const cdIdx = cmdToRun.indexOf(cdPrefix);
  if (cdIdx !== -1) {
    cmdToRun = cmdToRun.substring(cdIdx + cdPrefix.length);
  }

  // Cross-platform compatibility for Windows shell tests
  if (process.platform === 'win32' && cmdToRun.startsWith('Write-Output ')) {
    cmdToRun = 'echo ' + cmdToRun.replace('Write-Output ', '').replace(/"/g, '');
  }

  // Handle standard echo using native library functions instead of shelling out
  if (cmdToRun.startsWith('echo ')) {
    const echoContent = cmdToRun.slice(5).replace(/^["']|["']$/g, '');
    process.stdout.write(echoContent + '\n');
    process.exit(0);
  }

  // Tokenize safely into discrete executable and arguments without shell evaluation
  const tokens = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmdToRun.length; i++) {
    const c = cmdToRun[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        cur += c;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (/\s/.test(c)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
    } else {
      cur += c;
    }
  }
  if (cur) tokens.push(cur);

  const rawBinary = tokens[0] || 'echo';
  const execBinary = rawBinary === 'node' ? process.execPath : rawBinary;
  const execArgs = tokens.slice(1);

  const child = spawn(execBinary, execArgs, {
    cwd: workspaceDir,
    env: {
      ...process.env,
      HOME: workspaceDir,
      PWD: workspaceDir,
      NODE_ENV: 'production',
    },
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d) => process.stdout.write(d));
  child.stderr?.on('data', (d) => process.stderr.write(d));

  child.on('error', (err) => {
    process.stderr.write(`mock-docker error: ${err.message}\n`);
    process.exit(1);
  });

  child.on('close', (code) => {
    process.exit(typeof code === 'number' ? code : 0);
  });
} else {
  process.stdout.write(`mock-docker: command ${args[0]} acknowledged\n`);
  process.exit(0);
}
