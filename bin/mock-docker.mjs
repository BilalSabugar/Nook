#!/usr/bin/env node
/**
 * Mock Docker CLI for testing containerized sandbox execution on hosts
 * without a running Docker daemon (e.g. Windows unit tests).
 * Conforms to the `docker run` interface expected by sandbox-runner.mjs.
 */
import { exec } from 'child_process';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === 'version') {
  process.stdout.write('Docker version 27.0.0-mock, build abcdef0\n');
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

  // Cross-platform compatibility for Windows shell tests
  if (process.platform === 'win32' && cmdToRun.startsWith('Write-Output ')) {
    cmdToRun = 'echo ' + cmdToRun.replace('Write-Output ', '').replace(/"/g, '');
  }

  exec(cmdToRun, {
    cwd: workspaceDir,
    env: {
      ...process.env,
      HOME: workspaceDir,
      PWD: workspaceDir,
      NODE_ENV: 'production',
    },
    maxBuffer: 2 * 1024 * 1024,
  }, (err, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (err && typeof err.code === 'number') {
      process.exit(err.code);
    } else if (err) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  });
} else {
  process.stdout.write(`mock-docker: command ${args[0]} acknowledged\n`);
  process.exit(0);
}
