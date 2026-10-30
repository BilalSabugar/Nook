export interface McpRegisteredTool {
  name: string;
  description: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
  authorizationLevel: 'authenticated_read' | 'owner_direct' | 'human_approval_required';
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/**
 * Single authoritative registry for all callable Model Context Protocol (MCP) tools.
 * Every tool advertised in `tools/list` is defined here alongside its JSON schema,
 * safety hints, and authorization policy. Unregistered tool names are strictly rejected.
 */
export const REGISTERED_MCP_TOOLS: McpRegisteredTool[] = [
  {
    name: 'web_search',
    description:
      'Queries Wikipedia OpenSearch encyclopedic articles and technical reference summaries, returning verified source titles, snippets, and citation URLs.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    authorizationLevel: 'authenticated_read',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query keywords to look up in Wikipedia OpenSearch reference index',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Performs an SSRF-protected HTTP GET request to a public HTTPS/HTTP web URL, extracting page title, headings, and readable text content.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    authorizationLevel: 'authenticated_read',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full public http:// or https:// URL to fetch and extract content from',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'calculate',
    description:
      'Evaluates a mathematical expression safely using a deterministic arithmetic parser (+, -, *, /, %, ^, parentheses) without dynamic code evaluation.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    authorizationLevel: 'authenticated_read',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical formula to evaluate, e.g. "(1024 * 64) / 8"',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'format_document',
    description:
      'Formats raw research notes or bullet points into a structured Markdown document with executive summary, key findings, and action items.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    authorizationLevel: 'authenticated_read',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the document',
        },
        rawNotes: {
          type: 'string',
          description: 'Raw notes, observations, or paragraphs to structure into clean Markdown',
        },
      },
      required: ['title', 'rawNotes'],
    },
  },
  {
    name: 'github_get_repo_summary',
    description:
      'Fetches public repository metadata (stars, forks, open issues, primary language, and latest commit) from the GitHub REST API.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    authorizationLevel: 'authenticated_read',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub repository owner or organization (e.g. "vercel")',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name (e.g. "next.js")',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'analyze_document_structure',
    description:
      'Analyzes Markdown document structure, computing word count, estimated reading time, heading hierarchy, and code block statistics.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    authorizationLevel: 'authenticated_read',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown content to analyze',
        },
      },
      required: ['markdown'],
    },
  },
];

export const REGISTERED_MCP_TOOL_NAMES = new Set(REGISTERED_MCP_TOOLS.map((t) => t.name));

export function getRegisteredMcpTool(name: string): McpRegisteredTool | undefined {
  return REGISTERED_MCP_TOOLS.find((t) => t.name === name);
}
