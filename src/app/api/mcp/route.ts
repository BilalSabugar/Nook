import { NextRequest, NextResponse } from 'next/server';
import { REGISTERED_MCP_TOOLS } from '@/lib/mcp-registry';
import type { MCPToolDefinition } from '@/lib/mcp-registry';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { safeFetch } from '@/lib/ssrf';
import { logAuditEvent } from '@/lib/db';

export type { MCPToolDefinition };
export { REGISTERED_MCP_TOOLS };

export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  return NextResponse.json({
    jsonrpc: '2.0',
    server: {
      name: 'Nook Standard MCP Server',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
    },
    capabilities: {
      tools: {
        listChanged: true,
      },
      resources: {},
      prompts: {},
    },
    tools: REGISTERED_MCP_TOOLS,
  });
}

export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { method, params, id } = body;

    // 1. tools/list
    if (method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id || 1,
        result: {
          tools: REGISTERED_MCP_TOOLS,
        },
      });
    }

    // 2. tools/call
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};

      if (!name) {
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          error: { code: -32602, message: 'Tool name is required in params' },
        }, { status: 400 });
      }

      // Check if tool is known
      const toolDef = REGISTERED_MCP_TOOLS.find((t) => t.name === name);
      if (!toolDef) {
        logAuditEvent('MCP_UNKNOWN_TOOL', `Attempted call to unknown MCP tool: "${name}"`, 'error');
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          error: {
            code: -32601,
            message: `Unknown or unsupported MCP tool: "${name}". Valid tools are: ${REGISTERED_MCP_TOOLS.map((t) => t.name).join(', ')}`,
          },
        }, { status: 404 });
      }

      // ----------------------------------------------------
      // Tool: web_search
      // Queries Wikipedia OpenSearch API. Never fabricates citations.
      // ----------------------------------------------------
      if (name === 'web_search') {
        const query = (args?.query || '').trim();
        if (!query) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: 'Error: Search query cannot be empty.' }],
              isError: true,
            },
          });
        }

        try {
          const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json`;
          const fetchResult = await safeFetch(searchUrl, {
            headers: { 'User-Agent': 'NookBot/1.0 (https://github.com/BilalSabugar/Nook)' },
            timeoutMs: 6000,
          });

          if (!fetchResult.ok) {
            return NextResponse.json({
              jsonrpc: '2.0',
              id: id || 1,
              result: {
                content: [{ type: 'text', text: `Search API returned HTTP ${fetchResult.status}: ${fetchResult.statusText}` }],
                isError: true,
              },
            });
          }

          const data = JSON.parse(fetchResult.bodyText);
          const titles: string[] = data[1] || [];
          const descriptions: string[] = data[2] || [];
          const links: string[] = data[3] || [];

          if (titles.length === 0) {
            return NextResponse.json({
              jsonrpc: '2.0',
              id: id || 1,
              result: {
                content: [{ type: 'text', text: `No search results found for "${query}".` }],
              },
            });
          }

          const formattedResults = titles.map((title, i) => {
            const desc = descriptions[i] ? ` - ${descriptions[i]}` : '';
            const link = links[i] ? `\n   Source: ${links[i]}` : '';
            return `${i + 1}. **${title}**${desc}${link}`;
          }).join('\n\n');

          logAuditEvent('MCP_TOOL_EXEC', `web_search for "${query}" returned ${titles.length} results`, 'success');

          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: `Search Results for "${query}":\n\n${formattedResults}` }],
            },
          });
        } catch (searchErr: any) {
          // Authentic error reporting - no fabricated results
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: `Live web search failed: ${searchErr.message || 'Network error'}` }],
              isError: true,
            },
          });
        }
      }

      // ----------------------------------------------------
      // Tool: fetch_url
      // Must use centralized SSRF defense engine (safeFetch)
      // ----------------------------------------------------
      if (name === 'fetch_url') {
        const targetUrl = (args?.url || '').trim();
        if (!targetUrl) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: 'Error: URL parameter is required.' }],
              isError: true,
            },
          });
        }

        try {
          // Centralized SSRF protection: blocks private IPs, metadata, loopback, port scanning
          const fetchResult = await safeFetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 NookBot/1.0 (https://github.com/BilalSabugar/Nook)',
              'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
            },
            timeoutMs: 8000,
            maxBytes: 1024 * 1024, // 1MB max
          });

          if (!fetchResult.ok) {
            return NextResponse.json({
              jsonrpc: '2.0',
              id: id || 1,
              result: {
                content: [{ type: 'text', text: `Failed to fetch URL: HTTP ${fetchResult.status} ${fetchResult.statusText}` }],
                isError: true,
              },
            });
          }

          const rawText = fetchResult.bodyText;
          const titleMatch = rawText.match(/<title[^>]*>([^<]+)<\/title>/i);
          const pageTitle = titleMatch ? titleMatch[1].trim() : targetUrl;

          // Strip HTML tags and clean whitespace
          const cleanText = rawText
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3000);

          logAuditEvent('MCP_TOOL_EXEC', `fetch_url fetched: "${targetUrl}"`, 'success');

          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [
                {
                  type: 'text',
                  text: `# ${pageTitle}\n\n**Source:** ${fetchResult.finalUrl}\n\n${cleanText}`,
                },
              ],
            },
          });
        } catch (fetchErr: any) {
          logAuditEvent('MCP_TOOL_EXEC', `fetch_url blocked/failed for "${targetUrl}": ${fetchErr.message}`, 'error');
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: `URL fetch error: ${fetchErr.message}` }],
              isError: true,
            },
          });
        }
      }

      // ----------------------------------------------------
      // Tool: calculate
      // ----------------------------------------------------
      if (name === 'calculate') {
        const expr = String(args?.expression || '');
        if (!/^[0-9+\-*/().\s^%]+$/.test(expr)) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: 'Error: Invalid mathematical expression.' }],
              isError: true,
            },
          });
        }
        try {
          const answer = Function(`'use strict'; return (${expr})`)();
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: `Calculation result: ${answer}` }],
            },
          });
        } catch {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: 'Error evaluating math expression.' }],
              isError: true,
            },
          });
        }
      }

      // ----------------------------------------------------
      // Tool: format_document
      // ----------------------------------------------------
      if (name === 'format_document') {
        const title = args?.title || 'Draft Document';
        const notes = args?.rawNotes || '';
        const lines = notes.split('\n').filter((l: string) => l.trim().length > 0);
        const bulletPoints = lines.map((l: string) => `- ${l.replace(/^[-*]\s*/, '')}`).join('\n');

        const formatted = `# ${title}\n\n## 1. Executive Summary\n${notes.slice(0, 300).trim()}...\n\n## 2. Key Specifications\n${bulletPoints || '- No specifications provided.'}\n\n## 3. Action Items\n- [ ] Review technical content with assigned Coworker\n- [ ] Commit finalized draft to Living Spaces canvas\n\n*Generated via Nook MCP Document Engine*`;
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            content: [{ type: 'text', text: formatted }],
          },
        });
      }
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      id: id || 1,
      error: { code: -32601, message: `Method "${method}" not found.` },
    }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: err.message },
    }, { status: 500 });
  }
}
