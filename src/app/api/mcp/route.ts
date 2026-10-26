import { NextRequest, NextResponse } from 'next/server';
import { REGISTERED_MCP_TOOLS } from '@/lib/mcp-registry';
import type { MCPToolDefinition } from '@/lib/mcp-registry';
export type { MCPToolDefinition };
export { REGISTERED_MCP_TOOLS };


export async function GET() {
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
          error: { code: -32602, message: 'Tool name is required' },
        }, { status: 400 });
      }

      // Execute tool: web_search
      if (name === 'web_search') {
        const query = args?.query || '';
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            content: [
              {
                type: 'text',
                text: `Search Results for "${query}":\n1. CopilotKit & OpenDots Architecture Guide - Explains persistent agent computers and Spaces.\n2. AG-UI Protocol Standard - Event-driven streaming agent communication.\n3. Model Context Protocol (MCP) by Anthropic - Standardized tool calls.`,
              },
            ],
          },
        });
      }

      // Execute tool: calculate
      if (name === 'calculate') {
        const expr = String(args?.expression || '');
        // Safe evaluation of arithmetic only
        if (!/^[0-9+\-*/().\s^%]+$/.test(expr)) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{ type: 'text', text: 'Error: Invalid math expression' }],
              isError: true,
            },
          });
        }
        try {
          // eslint-disable-next-line no-eval
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
              content: [{ type: 'text', text: 'Error evaluating math expression' }],
              isError: true,
            },
          });
        }
      }

      // Execute tool: format_document
      if (name === 'format_document') {
        const title = args?.title || 'Draft Document';
        const notes = args?.rawNotes || '';
        const formatted = `# ${title}\n\n## Overview\n${notes}\n\n## Action Items\n- [ ] Review document\n- [ ] Publish to authorized Space`;
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            content: [{ type: 'text', text: formatted }],
          },
        });
      }

      // Fallback for unknown tool
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id || 1,
        result: {
          content: [{ type: 'text', text: `Executed MCP tool "${name}" with args: ${JSON.stringify(args)}` }],
        },
      });
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      id: id || 1,
      error: { code: -32601, message: `Method "${method}" not found` },
    }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: err.message },
    }, { status: 500 });
  }
}
