# Nook Plugin Developer Guide 🔌

This guide explains how to build, test, and register custom plugins and MCP tools for **Nook**.

---

## 1. Overview

Nook plugins provide modular extensions that grant AI coworkers specialized tools and capabilities without modifying Nook's core codebase.

Key plugin features:
- **Declarative Permissions**: Plugins explicitly declare required capabilities (`network`, `filesystem`, `shell`).
- **Human Approval Hooks**: Write and mutating actions require an interactive approval card before executing.
- **Execution Sandboxing**: Network calls must route through Nook's centralized SSRF validator (`safeFetch`), and shell actions run in isolated sandboxes.
- **Strict Timeouts**: Every tool execution is bounded by configurable timeouts (default 8,000ms).
- **Audit Logging**: All tool invocations and results are recorded in SQLite audit logs.

---

## 2. Plugin Manifest Structure

A Nook plugin is defined via `NookPluginManifest`:

```typescript
import { NookPluginManifest } from '@/lib/plugins';

export const customPlugin: NookPluginManifest = {
  id: 'plugin-sample-analyzer',
  name: 'Sample Code Analyzer',
  version: '1.0.0',
  description: 'Inspects code complexity and security markers.',
  author: 'Your Name or Team',
  capabilities: ['tools'],
  permissions: {
    network: false,
    filesystem: false,
    shell: false,
  },
  tools: [
    {
      name: 'calculate_complexity',
      description: 'Calculates cyclomatic complexity estimate for a source code string.',
      requiresApproval: false,
      timeoutMs: 5000,
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Raw source code string' },
        },
        required: ['code'],
      },
      handler: async (args) => {
        const code = String(args.code || '');
        // Logic here
        return {
          content: [{ type: 'text', text: `Complexity score: 4` }],
        };
      },
    },
  ],
};
```

---

## 3. Security Guidelines for Plugin Developers

1. **Never Bypass Network Controls**: Use `safeFetch` from `@/lib/ssrf` for all outbound HTTP requests. Do not use raw `fetch` to connect to internal or arbitrary endpoints.
2. **Never Expose Secrets in Output**: Strip all authorization headers, tokens, and private keys before returning `content`.
3. **Handle Errors Authentically**: If an external API returns HTTP 404 or 500, return a structured error message (`isError: true`) instead of fabricating mock success.
4. **Enforce Approval on Mutating Actions**: Any tool that writes to disk, alters external accounts, or issues commands must specify `requiresApproval: true`.

---

## 4. MCP Server Interoperability

Nook supports the official Model Context Protocol (MCP) JSON-RPC 2.0 specification on `/api/mcp`:
- `tools/list`: Lists all registered core and plugin tools.
- `tools/call`: Executes a tool with schema validation and approval enforcement.
