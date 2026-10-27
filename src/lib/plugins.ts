import { logAuditEvent } from './db.ts';
import { safeFetch } from './ssrf.ts';

export interface NookPluginTool {
  name: string;
  description: string;
  requiresApproval: boolean;
  timeoutMs?: number;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  handler: (args: Record<string, any>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
}

export interface NookPluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  capabilities: ('tools' | 'mcp_servers' | 'hooks')[];
  permissions: {
    network?: boolean;
    filesystem?: boolean;
    shell?: boolean;
  };
  tools: NookPluginTool[];
}

// -------------------------------------------------------------
// STANDARD EXAMPLE PLUGINS (Stage 6)
// -------------------------------------------------------------

/**
 * 1. GitHub Repository Inspector Plugin
 */
export const githubInspectorPlugin: NookPluginManifest = {
  id: 'plugin-github-inspector',
  name: 'GitHub Repository Inspector',
  version: '1.0.0',
  description: 'Inspects open-source GitHub repositories, commit trees, and release history via public APIs.',
  author: 'Nook Core Team',
  capabilities: ['tools'],
  permissions: { network: true },
  tools: [
    {
      name: 'github_get_repo_summary',
      description: 'Fetches repository statistics, star count, and description for a public GitHub repository.',
      requiresApproval: false,
      timeoutMs: 6000,
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'GitHub username or organization' },
          repo: { type: 'string', description: 'Repository name' },
        },
        required: ['owner', 'repo'],
      },
      handler: async (args) => {
        const owner = String(args.owner || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const repo = String(args.repo || '').replace(/[^a-zA-Z0-9._-]/g, '');
        if (!owner || !repo) {
          return { content: [{ type: 'text', text: 'Error: owner and repo must be provided.' }], isError: true };
        }

        const url = `https://api.github.com/repos/${owner}/${repo}`;
        const res = await safeFetch(url, {
          headers: { 'User-Agent': 'Nook-Plugin-GitHub/1.0' },
          timeoutMs: 6000,
        });

        if (!res.ok) {
          return { content: [{ type: 'text', text: `GitHub API error: HTTP ${res.status} ${res.statusText}` }], isError: true };
        }

        const data = JSON.parse(res.bodyText);
        const summary = [
          `# ${data.full_name}`,
          `**Description:** ${data.description || 'No description provided.'}`,
          `**Stars:** ${data.stargazers_count.toLocaleString()} • **Forks:** ${data.forks_count.toLocaleString()}`,
          `**Primary Language:** ${data.language || 'Multiple'}`,
          `**License:** ${data.license?.name || 'Unlicensed'}`,
          `**Default Branch:** ${data.default_branch}`,
          `**URL:** ${data.html_url}`,
        ].join('\n');

        return { content: [{ type: 'text', text: summary }] };
      },
    },
  ],
};

/**
 * 2. Document Processing Plugin
 */
export const docProcessorPlugin: NookPluginManifest = {
  id: 'plugin-doc-processor',
  name: 'Document Intelligence & Formatter',
  version: '1.0.0',
  description: 'Analyzes document readability, extracts heading outlines, and formats meeting minutes into action items.',
  author: 'Nook Core Team',
  capabilities: ['tools'],
  permissions: { filesystem: false, network: false },
  tools: [
    {
      name: 'analyze_document_structure',
      description: 'Generates structural table of contents and reading metrics for markdown text.',
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          markdown: { type: 'string', description: 'Markdown document string' },
        },
        required: ['markdown'],
      },
      handler: async (args) => {
        const text = String(args.markdown || '');
        const lines = text.split('\n');
        const headings = lines
          .filter((l) => /^#{1,4}\s/.test(l))
          .map((h) => {
            const level = h.match(/^#+/)?.[0].length || 1;
            const title = h.replace(/^#+\s*/, '').trim();
            return `${'  '.repeat(level - 1)}- ${title}`;
          });

        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

        const result = [
          `### Document Analysis`,
          `- **Total Words:** ${wordCount.toLocaleString()}`,
          `- **Estimated Reading Time:** ~${readTimeMinutes} min`,
          `- **Heading Count:** ${headings.length}`,
          `\n#### Heading Outline`,
          headings.join('\n') || '- No markdown headings detected.',
        ].join('\n');

        return { content: [{ type: 'text', text: result }] };
      },
    },
  ],
};

// -------------------------------------------------------------
// PLUGIN REGISTRY
// -------------------------------------------------------------
const REGISTERED_PLUGINS: Map<string, NookPluginManifest> = new Map([
  [githubInspectorPlugin.id, githubInspectorPlugin],
  [docProcessorPlugin.id, docProcessorPlugin],
]);

export function listInstalledPlugins(): Omit<NookPluginManifest, 'tools'>[] {
  return Array.from(REGISTERED_PLUGINS.values()).map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    author: p.author,
    capabilities: p.capabilities,
    permissions: p.permissions,
  }));
}

export function getAllPluginTools(): { pluginId: string; tool: NookPluginTool }[] {
  const result: { pluginId: string; tool: NookPluginTool }[] = [];
  for (const p of REGISTERED_PLUGINS.values()) {
    for (const t of p.tools) {
      result.push({ pluginId: p.id, tool: t });
    }
  }
  return result;
}

export async function executePluginTool(
  toolName: string,
  args: Record<string, any>,
  agentId = 'agent-system'
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  for (const p of REGISTERED_PLUGINS.values()) {
    const targetTool = p.tools.find((t) => t.name === toolName);
    if (targetTool) {
      logAuditEvent('PLUGIN_TOOL_EXEC', `Executing plugin tool "${toolName}" (Plugin: ${p.id})`, 'executing', agentId);

      // Execute tool with timeout
      const timeoutMs = targetTool.timeoutMs || 8000;
      const timeoutPromise = new Promise<{ content: { type: string; text: string }[]; isError: boolean }>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      try {
        const executionPromise = targetTool.handler(args);
        const result = await Promise.race([executionPromise, timeoutPromise]);
        logAuditEvent('PLUGIN_TOOL_COMPLETE', `Tool "${toolName}" finished successfully`, 'success', agentId);
        return result;
      } catch (err: any) {
        logAuditEvent('PLUGIN_TOOL_FAIL', `Tool "${toolName}" failed: ${err.message}`, 'error', agentId);
        return {
          content: [{ type: 'text', text: `Plugin tool error: ${err.message}` }],
          isError: true,
        };
      }
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown plugin tool: "${toolName}".` }],
    isError: true,
  };
}
