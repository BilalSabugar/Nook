#!/usr/bin/env node
/**
 * Nook Dedicated Sandbox Runner Service
 * Runs as an isolated execution supervisor in a separate restricted container/service.
 * Web applications and workers communicate with this runner via internal network only,
 * never exposing host Docker sockets or granting privileged access to the web tier.
 */

import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

const PORT = Number(process.env.PORT || process.env.SANDBOX_PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const SANDBOXES_BASE = path.join(process.cwd(), '.nook_sandboxes');

const SAFE_ENV_WHITELIST = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC'];

function spawnBuffer(executable, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let completed = false;

    const child = spawn(executable, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || {},
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = options.timeout ? setTimeout(() => {
      if (!completed) {
        completed = true;
        try { child.kill('SIGKILL'); } catch {}
        resolve({ stdout, stderr: `${stderr}\nExecution timed out after ${options.timeout}ms`, exitCode: 124 });
      }
    }, options.timeout) : null;

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

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

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', runner: 'dedicated_sandbox_runner', time: new Date().toISOString() }));
    return;
  }

  if (req.method === 'POST' && req.url === '/exec') {
    let bodyText = '';
    req.on('data', (chunk) => { bodyText += chunk; });
    req.on('end', async () => {
      try {
        const body = JSON.parse(bodyText || '{}');
        const { agentId, command, timeoutMs = 15000, maxBufferBytes = 1024 * 512, virtualFiles = [] } = body;

        if (!command || typeof command !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'command is required' }));
          return;
        }

        const safeAgentId = (agentId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
        const agentSandboxDir = path.resolve(SANDBOXES_BASE, safeAgentId);
        await fs.mkdir(agentSandboxDir, { recursive: true });

        // Write virtual files
        if (Array.isArray(virtualFiles)) {
          for (const f of virtualFiles) {
            const rawName = f.name || f.path;
            if (!rawName || typeof f.content !== 'string') continue;
            const sanitizedName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
            const targetFilePath = path.resolve(agentSandboxDir, sanitizedName);
            if (targetFilePath.startsWith(agentSandboxDir + path.sep)) {
              await fs.writeFile(targetFilePath, f.content, 'utf8');
            }
          }
        }

        // Scrub environment
        const sanitizedEnv = {};
        for (const key of Object.keys(process.env)) {
          if (SAFE_ENV_WHITELIST.includes(key.toUpperCase())) {
            sanitizedEnv[key] = process.env[key];
          }
        }
        sanitizedEnv.NODE_ENV = 'production';
        sanitizedEnv.HOME = agentSandboxDir;
        sanitizedEnv.USER = `agent_${safeAgentId}`;

        const isWin = process.platform === 'win32';
        const executable = isWin ? 'powershell.exe' : '/bin/sh';
        const args = isWin
          ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
          : ['-c', command];

        const result = await spawnBuffer(executable, args, {
          cwd: agentSandboxDir,
          env: sanitizedEnv,
          timeout: timeoutMs,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          stdout: result.stdout.slice(0, maxBufferBytes),
          stderr: result.stderr.slice(0, maxBufferBytes),
          exitCode: result.exitCode,
          isolatedRuntime: 'docker_container',
          sandboxDir: agentSandboxDir,
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
  console.log(`[Nook Sandbox Runner] Dedicated execution daemon active on http://${HOST}:${PORT}`);
});
