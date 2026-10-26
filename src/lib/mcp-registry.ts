export interface MCPToolDefinition {
  name: string;
  description: string;
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
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document Title' },
        rawNotes: { type: 'string', description: 'Raw notes or transcript' },
      },
      required: ['title', 'rawNotes'],
    },
  },
];
