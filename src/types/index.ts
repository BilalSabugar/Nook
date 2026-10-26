export type AgentStatus = 'idle' | 'thinking' | 'browsing' | 'executing' | 'waiting_review' | 'calling';

export type AgentRole = 
  | 'Research & Intelligence' 
  | 'Technical Writer' 
  | 'DevOps & Engineer' 
  | 'Executive Strategist'
  | 'Custom Specialist';

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  role: AgentRole;
  description: string;
  systemPrompt: string;
  status: AgentStatus;
  statusMessage?: string;
  color: string;
  allowedTools: string[];
  assignedSpaces: string[];
  computerEnabled: boolean;
  createdAt: string;
}

export interface ReviewRequest {
  id: string;
  agentId: string;
  agentName: string;
  type: 'save_page' | 'run_command' | 'mcp_action';
  title: string;
  description: string;
  targetSpaceId?: string;
  payload: {
    pageTitle?: string;
    pageContent?: string;
    command?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
  };
  status: 'pending' | 'approved' | 'declined' | 'rolled_back';
  createdPageId?: string;
  feedback?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  sender: 'user' | 'agent' | 'system';
  agentId?: string;
  content: string;
  timestamp: string;
  thoughtProcess?: string[];
  toolCall?: {
    toolName: string;
    status: 'running' | 'completed' | 'failed';
    input: Record<string, unknown>;
    output?: string;
  };
  reviewRequest?: ReviewRequest;
}

export interface DocumentVersion {
  version: number;
  content: string;
  title: string;
  updatedAt: string;
  authorAgentId?: string;
}

export interface DocumentPage {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  excerpt?: string;
  icon?: string;
  authorAgentId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  history?: DocumentVersion[];
  tags: string[];
}

export interface Space {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  pages: DocumentPage[];
  assignedAgentIds: string[];
  createdAt: string;
}

export interface VirtualFile {
  path: string;
  name: string;
  content: string;
  size: string;
  updatedAt: string;
  type: 'file' | 'directory';
}

export interface TerminalEntry {
  id: string;
  type: 'input' | 'output' | 'error' | 'system';
  text: string;
  timestamp: string;
}

export interface ComputerState {
  agentId: string;
  url: string;
  pageTitle: string;
  pageHtmlSnapshot?: string;
  isLoading: boolean;
  takeoverMode: boolean; // human takeover
  history: string[];
  historyIndex: number;
  terminalLogs: TerminalEntry[];
  files: VirtualFile[];
  activityLogs: {
    id: string;
    timestamp: string;
    action: string;
    details: string;
  }[];
}

export interface MCPTool {
  id: string;
  name: string;
  serverName: string;
  description: string;
  category: 'web' | 'code' | 'data' | 'system' | 'custom';
  enabled: boolean;
  requiresApproval: boolean;
  parameters: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
}

export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'simulation';

export interface LLMSettings {
  provider: LLMProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  ollamaEndpoint: string;
  model: string;
  temperature: number;
}
