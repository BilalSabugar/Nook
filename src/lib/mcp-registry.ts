export interface MCPToolDefinition {
  name: string;
  description: string;
  /** Host warning annotation: true if tool does not mutate server/host state */
  readOnlyHint: boolean;
  /** Host warning annotation: true if tool irreversibly modifies or deletes data */
  destructiveHint: boolean;
  /** Directory requirement: true if identical parameters produce identical side effects */
  idempotentHint: boolean;
  /** Directory requirement: true if tool accesses the open internet or external systems */
  openWorldHint: boolean;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const REGISTERED_MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Searches the live web for technical documentation, articles, and real-time news.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords or question' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Extracts full clean markdown text and metadata from any public web URL.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The web address to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'calculate',
    description: 'Evaluates mathematical and statistical formulas safely.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Mathematical expression e.g. 2 * 3.14159 * 5' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'format_document',
    description: 'Converts unstructured notes and bullet points into high-impact Markdown documentation.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document Title' },
        rawNotes: { type: 'string', description: 'Raw notes or transcript' },
      },
      required: ['title', 'rawNotes'],
    },
  },
  {
    name: 'github_get_repo_summary',
    description: 'Fetches repository statistics, star count, and metadata for a public GitHub repository.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'GitHub username or organization' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'analyze_document_structure',
    description: 'Generates structural table of contents and reading metrics for markdown text.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Markdown document string' },
      },
      required: ['markdown'],
    },
  },
];
