import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    name: 'Nook Agent Operating System',
    mode: 'vibe-coded',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    features: {
      vibeCoded: true,
      persistentAgents: true,
      agentComputerSandbox: true,
      spacesDocumentWorkspace: true,
      humanInTheLoopReviews: true,
      mcpIntegrations: true,
    },
    configuredProviders: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      ollama: Boolean(process.env.OLLAMA_BASE_URL),
    },
  });
}
