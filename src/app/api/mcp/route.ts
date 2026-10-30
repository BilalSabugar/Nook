import { NextRequest, NextResponse } from 'next/server.js';
import crypto from 'node:crypto';
import { REGISTERED_MCP_TOOLS, getRegisteredMcpTool } from '../../../lib/mcp-registry.ts';
import type { McpRegisteredTool } from '../../../lib/mcp-registry.ts';
import { validateApiRequest, unauthorizedResponse } from '../../../lib/auth.ts';
import { safeFetch } from '../../../lib/ssrf.ts';
import { logAuditEvent, listSpacesWithDocuments, onDocumentUpdated } from '../../../lib/db.ts';
import { executePluginTool, getAllPluginTools } from '../../../lib/plugins.ts';
import { INITIAL_SPACES } from '../../../lib/store.ts';

/**
 * Safely parses and evaluates mathematical expressions deterministically.
 * Employs standard tokenization and Shunting-Yard evaluation with strict bounds and division-by-zero checks.
 */
function evaluateSafeMath(expr: string): number {
  const clean = expr.replace(/\s+/g, '');
  if (!clean || !/^[0-9+\-*/().%^]+$/.test(clean)) {
    throw new Error('Invalid mathematical expression.');
  }

  const tokens: (string | number)[] = [];
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '(' || ch === ')') {
      tokens.push(ch);
      i++;
    } else if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '^') {
      if (ch === '*' && clean[i + 1] === '*') {
        tokens.push('^');
        i += 2;
      } else {
        const prev = tokens[tokens.length - 1];
        if (
          (ch === '-' || ch === '+') &&
          (tokens.length === 0 || prev === '(' || (typeof prev === 'string' && ['+', '-', '*', '/', '%', '^'].includes(prev)))
        ) {
          let numStr = ch;
          i++;
          while (i < clean.length && ((clean[i] >= '0' && clean[i] <= '9') || clean[i] === '.')) {
            numStr += clean[i];
            i++;
          }
          if (numStr === '-' || numStr === '+') {
            tokens.push(ch === '-' ? -1 : 1);
            tokens.push('*');
          } else {
            const num = parseFloat(numStr);
            if (isNaN(num)) throw new Error('Invalid numeric literal');
            tokens.push(num);
          }
        } else {
          tokens.push(ch);
          i++;
        }
      }
    } else if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = '';
      while (i < clean.length && ((clean[i] >= '0' && clean[i] <= '9') || clean[i] === '.')) {
        numStr += clean[i];
        i++;
      }
      const num = parseFloat(numStr);
      if (isNaN(num)) throw new Error('Invalid numeric literal');
      tokens.push(num);
    } else {
      throw new Error(`Unexpected character: ${ch}`);
    }
  }

  const precedence: Record<string, number> = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
    '%': 2,
    '^': 3,
  };

  const outputQueue: (number | string)[] = [];
  const operatorStack: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'number') {
      outputQueue.push(token);
    } else if (token in precedence) {
      while (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1] !== '(' &&
        precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
      ) {
        outputQueue.push(operatorStack.pop()!);
      }
      operatorStack.push(token);
    } else if (token === '(') {
      operatorStack.push(token);
    } else if (token === ')') {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
        outputQueue.push(operatorStack.pop()!);
      }
      if (operatorStack.length === 0) {
        throw new Error('Mismatched parentheses');
      }
      operatorStack.pop();
    }
  }

  while (operatorStack.length > 0) {
    const op = operatorStack.pop()!;
    if (op === '(' || op === ')') {
      throw new Error('Mismatched parentheses');
    }
    outputQueue.push(op);
  }

  const evalStack: number[] = [];
  for (const item of outputQueue) {
    if (typeof item === 'number') {
      evalStack.push(item);
    } else {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) {
        throw new Error('Malformed arithmetic expression');
      }
      switch (item) {
        case '+': evalStack.push(a + b); break;
        case '-': evalStack.push(a - b); break;
        case '*': evalStack.push(a * b); break;
        case '/':
          if (b === 0) throw new Error('Division by zero');
          evalStack.push(a / b);
          break;
        case '%': evalStack.push(a % b); break;
        case '^': evalStack.push(Math.pow(a, b)); break;
        default: throw new Error(`Unsupported operator: ${item}`);
      }
    }
  }

  if (evalStack.length !== 1) {
    throw new Error('Invalid calculation outcome');
  }

  return evalStack[0];
}

export type { McpRegisteredTool, McpRegisteredTool as MCPToolDefinition };
export { REGISTERED_MCP_TOOLS };

// ==============================================================
// MCP RESOURCES & PROMPTS DEFINITIONS
// ==============================================================

interface LivingDoc {
  id: string;
  spaceId: string;
  spaceName: string;
  title: string;
  content: string;
  excerpt?: string;
}

function getAllLivingDocuments(): LivingDoc[] {
  try {
    const dbSpaces = listSpacesWithDocuments();
    if (dbSpaces && dbSpaces.length > 0) {
      const docs: LivingDoc[] = [];
      for (const s of dbSpaces) {
        for (const p of s.pages || []) {
          docs.push({
            id: p.id,
            spaceId: s.id,
            spaceName: s.name,
            title: p.title,
            content: p.content,
            excerpt: p.excerpt,
          });
        }
      }
      if (docs.length > 0) return docs;
    }
  } catch {}

  const docs: LivingDoc[] = [];
  for (const s of INITIAL_SPACES) {
    for (const p of s.pages || []) {
      docs.push({
        id: p.id,
        spaceId: s.id,
        spaceName: s.name,
        title: p.title,
        content: p.content,
        excerpt: p.excerpt,
      });
    }
  }
  return docs;
}

function getLivingDocument(uri: string): LivingDoc | null {
  const docs = getAllLivingDocuments();
  for (const d of docs) {
    if (
      uri === `nook://spaces/${d.spaceId}/documents/${d.id}` ||
      uri === `nook://documents/${d.id}` ||
      uri.endsWith(`/${d.id}`)
    ) {
      return d;
    }
  }
  return null;
}

export interface MCPPromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
}

export const MCP_PROMPTS: MCPPromptDefinition[] = [
  {
    name: 'research_brief',
    description: 'Conduct deep technical research on a topic with Scout, producing verified citations and synthesized takeaways.',
    arguments: [
      { name: 'topic', description: 'Technical subject, open-source project, or architectural paradigm to investigate', required: true },
      { name: 'depth', description: 'Desired depth: "summary" or "comprehensive"', required: false },
    ],
  },
  {
    name: 'technical_specification',
    description: 'Draft publication-grade documentation or an RFC architectural design document with Quill.',
    arguments: [
      { name: 'title', description: 'Document title', required: true },
      { name: 'requirements', description: 'Core requirements or architectural objectives', required: true },
    ],
  },
  {
    name: 'code_implementation',
    description: 'Implement a complete, production-grade ES module solution and unit test suite with Cipher.',
    arguments: [
      { name: 'objective', description: 'Software engineering task or feature requirement', required: true },
      { name: 'testFramework', description: 'Test framework (e.g. "node:test")', required: false },
    ],
  },
  {
    name: 'mission_orchestration',
    description: 'Formulate an end-to-end multi-agent mission with milestone decomposition and evidence verification using Aura.',
    arguments: [
      { name: 'goal', description: 'Strategic goal for autonomous coworkers to execute', required: true },
    ],
  },
];

function generatePromptMessages(name: string, args: Record<string, string>): {
  description: string;
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
} {
  if (name === 'research_brief') {
    const topic = args.topic || 'Software Architecture';
    return {
      description: `Scout Research Directive for: ${topic}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are Scout, Nook's Research & Intelligence Coworker. Investigate "${topic}" thoroughly. Query live technical documentation, extract authoritative references, and synthesize key architectural findings into structured takeaways. Never fabricate citations.`,
          },
        },
      ],
    };
  }

  if (name === 'technical_specification') {
    const title = args.title || 'Technical Architecture';
    const reqs = args.requirements || 'Standard production architecture';
    return {
      description: `Quill Specification Directive: ${title}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are Quill, Nook's Technical Documentation Specialist. Draft an executive technical specification titled "${title}". Incorporate the following core requirements:\n${reqs}\nStructure the output into Executive Summary, Architecture Specifications, and Action Items.`,
          },
        },
      ],
    };
  }

  if (name === 'code_implementation') {
    const objective = args.objective || 'Software Component';
    return {
      description: `Cipher Code Execution Directive: ${objective}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are Cipher, Nook's Autonomous Engineering Coworker. Implement a verified, robust ES module solution and specification-driven unit test suite for: "${objective}". Enforce fail-closed security, path containment, and strict verification.`,
          },
        },
      ],
    };
  }

  const goal = args.goal || 'Autonomous Mission';
  return {
    description: `Aura Mission Planning: ${goal}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `You are Aura, Nook's Executive Supervisor Coworker. Decompose the strategic objective "${goal}" into sequential, verifiable milestones. Coordinate Scout for investigation, Quill for documentation, and Cipher for implementation and sandboxed test execution.`,
        },
      },
    ],
  };
}

// ==============================================================
// JSON-RPC 2.0 PROTOCOL ENGINE & MCP 2024-11-05 SPECIFICATION
// ==============================================================

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-nook-api-key, x-nook-session-token, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

interface SseSession {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  createdAt: number;
  lastActiveAt: number;
}

type McpNotificationListener = (notification: { jsonrpc: '2.0'; method: string; params: Record<string, any> }, sessionId?: string) => void;

const g = globalThis as unknown as {
  _mcpSseSessions?: Map<string, SseSession>;
  _mcpResourceSubscriptions?: Map<string, Set<string>>;
  _mcpNotificationListeners?: Set<McpNotificationListener>;
  _mcpDocListenerRegistered?: boolean;
};
if (!g._mcpSseSessions) {
  g._mcpSseSessions = new Map<string, SseSession>();
}
if (!g._mcpResourceSubscriptions) {
  g._mcpResourceSubscriptions = new Map<string, Set<string>>();
}
if (!g._mcpNotificationListeners) {
  g._mcpNotificationListeners = new Set<McpNotificationListener>();
}
const sseSessions = g._mcpSseSessions;
const resourceSubscriptions = g._mcpResourceSubscriptions;
const notificationListeners = g._mcpNotificationListeners;

function cleanupSessionSubscriptions(sessionId: string): void {
  for (const [uri, subs] of resourceSubscriptions.entries()) {
    subs.delete(sessionId);
    if (subs.size === 0) {
      resourceSubscriptions.delete(uri);
    }
  }
}

export function subscribeMcpResource(uri: string, sessionId: string = '__default_session__'): void {
  let subs = resourceSubscriptions.get(uri);
  if (!subs) {
    subs = new Set<string>();
    resourceSubscriptions.set(uri, subs);
  }
  subs.add(sessionId);
}

export function unsubscribeMcpResource(uri: string, sessionId: string = '__default_session__'): void {
  const subs = resourceSubscriptions.get(uri);
  if (!subs) return;
  subs.delete(sessionId);
  if (subs.size === 0) {
    resourceSubscriptions.delete(uri);
  }
}

export function getMcpResourceSubscribers(uri: string): string[] {
  return Array.from(resourceSubscriptions.get(uri) || []);
}

export function onMcpNotification(listener: McpNotificationListener): () => void {
  notificationListeners.add(listener);
  return () => {
    notificationListeners.delete(listener);
  };
}

export function notifyMcpResourceUpdated(uri: string): number {
  const subs = resourceSubscriptions.get(uri);
  if (!subs || subs.size === 0) return 0;

  const notification = {
    jsonrpc: '2.0' as const,
    method: 'notifications/resources/updated',
    params: { uri },
  };

  let delivered = 0;
  for (const sessionId of Array.from(subs)) {
    if (sessionId !== '__default_session__' && sseSessions.has(sessionId)) {
      if (sendMcpSessionMessage(sessionId, notification)) {
        delivered++;
      }
    } else if (sessionId === '__default_session__') {
      delivered++;
    }
    for (const listener of notificationListeners) {
      try {
        listener(notification, sessionId);
      } catch {
        // ignore listener errors
      }
    }
  }
  return delivered;
}

if (!g._mcpDocListenerRegistered) {
  g._mcpDocListenerRegistered = true;
  onDocumentUpdated((uri) => {
    notifyMcpResourceUpdated(uri);
  });
}

export function sendMcpSessionMessage(sessionId: string, message: any): boolean {
  const session = sseSessions.get(sessionId);
  if (!session) return false;
  try {
    session.lastActiveAt = Date.now();
    const encoder = new TextEncoder();
    const payload = JSON.stringify(message);
    session.controller.enqueue(encoder.encode(`event: message\r\ndata: ${payload}\r\n\r\n`));
    return true;
  } catch {
    sseSessions.delete(sessionId);
    cleanupSessionSubscriptions(sessionId);
    return false;
  }
}

export async function handleJsonRpcRequest(body: any, context?: { sessionId?: string } | string): Promise<any> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request: Expected a JSON object.' },
    };
  }

  const { method, params } = body;
  const hasId = 'id' in body;
  const id = body.id;
  const isNotification = !hasId || id === undefined;
  const responseId = hasId ? (id ?? null) : 1;

  if (!method || typeof method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: hasId ? (id ?? null) : null,
      error: { code: -32600, message: 'Invalid Request: method string is required.' },
    };
  }

  // 1. initialize Handshake (MCP Spec 2024-11-05)
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
          logging: {},
          roots: { listChanged: true },
        },
        serverInfo: {
          name: 'nook',
          version: '1.0.0',
        },
        instructions: 'Nook Standard MCP Server provides sovereign tools, living spaces documentation resources, and coworker prompts for autonomous AI agents.',
      },
    };
  }

  // 2. notifications/initialized & initialized
  if (method === 'notifications/initialized' || method === 'initialized') {
    if (isNotification || id === null) {
      return null; // Standard notification returns no body (204)
    }
    return { jsonrpc: '2.0', id: responseId, result: {} };
  }

  // 3. notifications/cancelled or general notification methods
  if (method.startsWith('notifications/') && isNotification) {
    return null;
  }

  // 4. ping
  if (method === 'ping') {
    return { jsonrpc: '2.0', id: responseId, result: {} };
  }

  // 5. tools/list
  if (method === 'tools/list') {
    const coreTools = REGISTERED_MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      readOnlyHint: t.readOnlyHint,
      destructiveHint: t.destructiveHint,
      idempotentHint: t.idempotentHint,
      openWorldHint: t.openWorldHint,
      annotations: {
        readOnlyHint: t.readOnlyHint,
        destructiveHint: t.destructiveHint,
        idempotentHint: t.idempotentHint,
        openWorldHint: t.openWorldHint,
      },
      inputSchema: t.inputSchema,
    }));

    const pluginTools = getAllPluginTools().map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      readOnlyHint: tool.readOnlyHint,
      destructiveHint: tool.destructiveHint,
      idempotentHint: tool.idempotentHint,
      openWorldHint: tool.openWorldHint,
      annotations: {
        readOnlyHint: tool.readOnlyHint,
        destructiveHint: tool.destructiveHint,
        idempotentHint: tool.idempotentHint,
        openWorldHint: tool.openWorldHint,
      },
      inputSchema: tool.inputSchema,
    }));

    const seen = new Set<string>();
    const allTools: any[] = [];
    for (const t of [...coreTools, ...pluginTools]) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        allTools.push(t);
      }
    }

    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {
        tools: allTools,
      },
    };
  }

  // 6. tools/call
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? params?.args ?? params ?? {};

    if (!name) {
      return {
        jsonrpc: '2.0',
        id: responseId,
        error: { code: -32602, message: 'Tool name is required in params' },
      };
    }

    const toolDef: McpRegisteredTool | undefined = getRegisteredMcpTool(name);
    const pluginTools = getAllPluginTools();
    const pluginMatch = pluginTools.find((pt) => pt.tool.name === name);

    if (!toolDef && !pluginMatch) {
      logAuditEvent('MCP_UNKNOWN_TOOL', `Attempted call to unknown or unadvertised MCP tool: "${name}"`, 'error');
      return {
        jsonrpc: '2.0',
        id: responseId,
        error: {
          code: -32601,
          message: `Unknown or unsupported MCP tool: "${name}". Valid tools are: ${REGISTERED_MCP_TOOLS.map((t) => t.name).join(', ')}`,
        },
      };
    }

    // Tool: web_search
    if (name === 'web_search') {
      const query = (args?.query || '').trim();
      if (!query) {
        return {
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            content: [{ type: 'text', text: 'Error: Search query cannot be empty.' }],
            isError: true,
          },
        };
      }

      try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json`;
        const fetchResult = await safeFetch(searchUrl, {
          headers: { 'User-Agent': 'NookBot/1.0 (https://github.com/BilalSabugar/Nook)' },
          timeoutMs: 6000,
        });

        if (!fetchResult.ok) {
          return {
            jsonrpc: '2.0',
            id: id ?? 1,
            result: {
              content: [{ type: 'text', text: `Search API returned HTTP ${fetchResult.status}: ${fetchResult.statusText}` }],
              isError: true,
            },
          };
        }

        const data = JSON.parse(fetchResult.bodyText);
        const titles: string[] = data[1] || [];
        const descriptions: string[] = data[2] || [];
        const links: string[] = data[3] || [];

        if (titles.length === 0) {
          return {
            jsonrpc: '2.0',
            id: responseId,
            result: {
              content: [{ type: 'text', text: `No search results found for "${query}".` }],
              isError: false,
            },
          };
        }

        const formattedResults = titles.map((title, i) => {
          const desc = descriptions[i] ? ` - ${descriptions[i]}` : '';
          const link = links[i] ? `\n   Source: ${links[i]}` : '';
          return `${i + 1}. **${title}**${desc}${link}`;
        }).join('\n\n');

        logAuditEvent('MCP_TOOL_EXEC', `web_search for "${query}" returned ${titles.length} results`, 'success');

        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            content: [{ type: 'text', text: `Search Results for "${query}":\n\n${formattedResults}` }],
            isError: false,
          },
        };
      } catch (searchErr: any) {
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            content: [{ type: 'text', text: `Live web search failed: ${searchErr.message || 'Network error'}` }],
            isError: true,
          },
        };
      }
    }

    // Tool: fetch_url
    if (name === 'fetch_url') {
      const targetUrl = (args?.url || '').trim();
      if (!targetUrl) {
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            content: [{ type: 'text', text: 'Error: URL parameter is required.' }],
            isError: true,
          },
        };
      }

      try {
        const fetchResult = await safeFetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 NookBot/1.0 (https://github.com/BilalSabugar/Nook)',
            'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
          },
          timeoutMs: 8000,
          maxBytes: 1024 * 1024,
        });

        if (!fetchResult.ok) {
          return {
            jsonrpc: '2.0',
            id: responseId,
            result: {
              content: [{ type: 'text', text: `Failed to fetch URL: HTTP ${fetchResult.status} ${fetchResult.statusText}` }],
              isError: true,
            },
          };
        }

        const rawText = fetchResult.bodyText;
        const titleMatch = rawText.match(/<title[^>]*>([^<]+)<\/title>/i);
        const pageTitle = titleMatch ? titleMatch[1].trim() : targetUrl;

        const cleanText = rawText
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 3000);

        logAuditEvent('MCP_TOOL_EXEC', `fetch_url fetched: "${targetUrl}"`, 'success');

        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            content: [
              {
                type: 'text',
                text: `# ${pageTitle}\n\n**Source:** ${fetchResult.finalUrl}\n\n${cleanText}`,
              },
            ],
            isError: false,
          },
        };
      } catch (fetchErr: any) {
        logAuditEvent('MCP_TOOL_EXEC', `fetch_url blocked/failed for "${targetUrl}": ${fetchErr.message}`, 'error');
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            content: [{ type: 'text', text: `URL fetch error: ${fetchErr.message}` }],
            isError: true,
          },
        };
      }
    }

    // Tool: calculate
    if (name === 'calculate') {
      const expr = String(args?.expression || '');
      if (!/^[0-9+\-*/().\s^%]+$/.test(expr)) {
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            content: [{ type: 'text', text: 'Error: Invalid mathematical expression.' }],
            isError: true,
          },
        };
      }
      try {
        const answer = evaluateSafeMath(expr);
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            content: [{ type: 'text', text: `Calculation result: ${answer}` }],
            isError: false,
          },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id: responseId,
          result: {
            content: [{ type: 'text', text: `Error evaluating math expression: ${err.message}` }],
            isError: true,
          },
        };
      }
    }

    // Tool: format_document
    if (name === 'format_document') {
      const title = args?.title || 'Draft Document';
      const notes = args?.rawNotes || '';
      const lines = notes.split('\n').filter((l: string) => l.trim().length > 0);
      const bulletPoints = lines.map((l: string) => `- ${l.replace(/^[-*]\s*/, '')}`).join('\n');

      const formatted = `# ${title}\n\n## 1. Executive Summary\n${notes.slice(0, 300).trim()}...\n\n## 2. Key Specifications\n${bulletPoints || '- No specifications provided.'}\n\n## 3. Action Items\n- [ ] Review technical content with assigned Coworker\n- [ ] Commit finalized draft to Living Spaces canvas\n\n*Generated via Nook MCP Document Engine*`;
      return {
        jsonrpc: '2.0',
        id: responseId,
        result: {
          content: [{ type: 'text', text: formatted }],
          isError: false,
        },
      };
    }

    // Plugin-backed Tools
    if (pluginMatch || name === 'github_get_repo_summary' || name === 'analyze_document_structure') {
      const pluginResult = await executePluginTool(name, args || {});
      return {
        jsonrpc: '2.0',
        id: responseId,
        result: {
          ...pluginResult,
          isError: pluginResult.isError || false,
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id: responseId,
      error: {
        code: -32601,
        message: `Unknown or unsupported MCP tool: "${name}". Valid tools are: ${REGISTERED_MCP_TOOLS.map((t) => t.name).join(', ')}`,
      },
    };
  }

  // 7. resources/list
  if (method === 'resources/list') {
    const docs = getAllLivingDocuments();
    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {
        resources: docs.map((d) => ({
          uri: `nook://spaces/${d.spaceId}/documents/${d.id}`,
          name: `${d.spaceName} / ${d.title}`,
          description: d.excerpt || `Living space document: ${d.title}`,
          mimeType: 'text/markdown',
        })),
      },
    };
  }

  // 8. resources/read
  if (method === 'resources/read') {
    const uri = String(params?.uri || '');
    if (!uri) {
      return {
        jsonrpc: '2.0',
        id: responseId,
        error: { code: -32602, message: 'URI parameter is required for resources/read' },
      };
    }
    const doc = getLivingDocument(uri);
    if (!doc) {
      return {
        jsonrpc: '2.0',
        id: responseId,
        error: { code: -32602, message: `Resource not found: "${uri}"` },
      };
    }
    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: doc.content,
          },
        ],
      },
    };
  }

  // 9. resources/templates/list
  if (method === 'resources/templates/list') {
    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {
        resourceTemplates: [
          {
            uriTemplate: 'nook://spaces/{spaceId}/documents/{documentId}',
            name: 'Nook Space Document',
            description: 'Access any document within a Nook living space by Space ID and Document ID',
            mimeType: 'text/markdown',
          },
        ],
      },
    };
  }

  // 10. resources/subscribe & resources/unsubscribe (MCP Spec 2024-11-05)
  if (method === 'resources/subscribe' || method === 'resources/unsubscribe') {
    const uri = String(params?.uri || '').trim();
    if (!uri || !uri.startsWith('nook://')) {
      return {
        jsonrpc: '2.0',
        id: responseId,
        error: { code: -32602, message: 'Valid nook:// resource URI parameter is required for subscription operations' },
      };
    }
    const subSessionId = (typeof context === 'string' ? context : context?.sessionId) || '__default_session__';
    if (method === 'resources/subscribe') {
      subscribeMcpResource(uri, subSessionId);
    } else {
      unsubscribeMcpResource(uri, subSessionId);
    }
    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {},
    };
  }

  // 11. prompts/list
  if (method === 'prompts/list') {
    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {
        prompts: MCP_PROMPTS,
      },
    };
  }

  // 12. prompts/get
  if (method === 'prompts/get') {
    const promptName = String(params?.name || '');
    const promptDef = MCP_PROMPTS.find((p) => p.name === promptName);
    if (!promptDef) {
      return {
        jsonrpc: '2.0',
        id: responseId,
        error: { code: -32601, message: `Prompt "${promptName}" not found` },
      };
    }
    return {
      jsonrpc: '2.0',
      id: responseId,
      result: generatePromptMessages(promptName, params?.arguments || {}),
    };
  }

  // 13. completion/complete (MCP Spec 2024-11-05)
  if (method === 'completion/complete') {
    const ref = params?.ref || {};
    const argument = params?.argument || {};
    const argName = argument.name || '';
    const argValue = String(argument.value || '').toLowerCase();

    const values: string[] = [];
    if (ref.type === 'ref/prompt') {
      if (argName === 'topic') {
        const docs = getAllLivingDocuments();
        for (const d of docs) {
          if (d.title.toLowerCase().includes(argValue)) {
            values.push(d.title);
          }
        }
        if (values.length === 0) {
          values.push('Autonomous Coworkers', 'Living Spaces', 'Agent Sandbox Security');
        }
      } else if (argName === 'depth') {
        values.push('summary', 'comprehensive');
      } else if (argName === 'testFramework') {
        values.push('node:test', 'jest', 'vitest');
      } else if (argName === 'title') {
        values.push('Technical Architecture RFC', 'Engineering Specification', 'Security Whitepaper');
      }
    } else if (ref.type === 'ref/resource') {
      const docs = getAllLivingDocuments();
      for (const d of docs) {
        const uri = `nook://spaces/${d.spaceId}/documents/${d.id}`;
        if (uri.toLowerCase().includes(argValue)) {
          values.push(uri);
        }
      }
    }

    const filtered = values.filter((v) => v.toLowerCase().includes(argValue)).slice(0, 20);

    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {
        completion: {
          values: filtered,
          total: filtered.length,
          hasMore: false,
        },
      },
    };
  }

  // 14. roots/list (MCP Spec 2024-11-05)
  if (method === 'roots/list') {
    return {
      jsonrpc: '2.0',
      id: responseId,
      result: {
        roots: [
          {
            uri: 'nook://spaces',
            name: 'Nook Spaces Living Documents',
          },
        ],
      },
    };
  }

  // 15. logging/setLevel
  if (method === 'logging/setLevel') {
    return { jsonrpc: '2.0', id: responseId, result: {} };
  }

  return {
    jsonrpc: '2.0',
    id: responseId,
    error: { code: -32601, message: `Method "${method}" not found.` },
  };
}

// ==============================================================
// HTTP HANDLERS (OPTIONS, GET: SSE & Discovery, POST: JSON-RPC)
// ==============================================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const acceptHeader = req.headers.get('accept') || '';
  const searchParams = new URL(req.url).searchParams;
  const isSSE = acceptHeader.includes('text/event-stream') || searchParams.get('transport') === 'sse';

  // Standard MCP Server-Sent Events (SSE) Transport
  if (isSSE) {
    const sessionId = crypto.randomUUID();
    let keepAliveTimer: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const now = Date.now();
        sseSessions.set(sessionId, {
          id: sessionId,
          controller,
          createdAt: now,
          lastActiveAt: now,
        });

        const encoder = new TextEncoder();
        // Emit MCP SSE endpoint event instructing client where to POST messages
        const endpointUrl = `/api/mcp?sessionId=${sessionId}`;
        controller.enqueue(encoder.encode(`event: endpoint\r\ndata: ${endpointUrl}\r\n\r\n`));

        // Periodic keepalive comment as per SSE spec
        keepAliveTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\r\n\r\n`));
          } catch {
            if (keepAliveTimer) clearInterval(keepAliveTimer);
            sseSessions.delete(sessionId);
            cleanupSessionSubscriptions(sessionId);
          }
        }, 15000);
        if (keepAliveTimer && typeof keepAliveTimer.unref === 'function') {
          keepAliveTimer.unref();
        }
      },
      cancel() {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        sseSessions.delete(sessionId);
        cleanupSessionSubscriptions(sessionId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Mcp-Session-Id': sessionId,
        ...corsHeaders,
      },
    });
  }

  // Standard HTTP Discovery Response
  const docs = getAllLivingDocuments();
  return NextResponse.json({
    jsonrpc: '2.0',
    server: {
      name: 'nook',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
    },
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
      logging: {},
      roots: { listChanged: true },
    },
    tools: REGISTERED_MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      readOnlyHint: t.readOnlyHint,
      destructiveHint: t.destructiveHint,
      idempotentHint: t.idempotentHint,
      openWorldHint: t.openWorldHint,
      annotations: {
        readOnlyHint: t.readOnlyHint,
        destructiveHint: t.destructiveHint,
        idempotentHint: t.idempotentHint,
        openWorldHint: t.openWorldHint,
      },
      inputSchema: t.inputSchema,
    })),
    resources: docs.map((d) => ({
      uri: `nook://spaces/${d.spaceId}/documents/${d.id}`,
      name: `${d.spaceName} / ${d.title}`,
      description: d.excerpt || `Living space document: ${d.title}`,
      mimeType: 'text/markdown',
    })),
    prompts: MCP_PROMPTS,
  }, {
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const url = new URL(req.url);
  const sessionId = (req.headers.get('mcp-session-id') || url.searchParams.get('sessionId') || '').trim();

  // If caller explicitly targets an SSE sessionId that does not exist or has expired, fail with 404
  if (sessionId && !sseSessions.has(sessionId)) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: `Unknown or expired MCP SSE session: "${sessionId}"` },
      },
      { status: 404, headers: corsHeaders }
    );
  }

  try {
    const body = await req.json();
    const rpcContext = sessionId ? { sessionId } : undefined;

    // Handle JSON-RPC batch requests
    if (Array.isArray(body)) {
      if (body.length === 0) {
        return NextResponse.json(
          { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: empty batch' } },
          { status: 400, headers: corsHeaders }
        );
      }

      const results = await Promise.all(body.map((item) => handleJsonRpcRequest(item, rpcContext)));
      const filtered = results.filter((r) => r !== null);
      if (filtered.length === 0) {
        return new NextResponse(null, { status: 204, headers: corsHeaders });
      }

      if (sessionId && sseSessions.has(sessionId)) {
        for (const resItem of filtered) {
          sendMcpSessionMessage(sessionId, resItem);
        }
        return NextResponse.json(filtered, { status: 202, headers: { ...corsHeaders, 'Mcp-Session-Id': sessionId } });
      }

      return NextResponse.json(filtered, { headers: corsHeaders });
    }

    const response = await handleJsonRpcRequest(body, rpcContext);
    if (response === null) {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }

    if (sessionId && sseSessions.has(sessionId)) {
      sendMcpSessionMessage(sessionId, response);
      return NextResponse.json(response, {
        status: 202,
        headers: {
          ...corsHeaders,
          'Mcp-Session-Id': sessionId,
        },
      });
    }

    const status = response.error ? (response.error.code === -32601 ? 404 : 400) : 200;
    return NextResponse.json(response, { status, headers: corsHeaders });
  } catch (err: any) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${err.message}` },
    }, { status: 400, headers: corsHeaders });
  }
}
