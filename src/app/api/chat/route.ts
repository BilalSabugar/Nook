import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { loadEncryptedSecrets, SUPPORTED_MODELS } from '@/lib/secrets';
import { logAuditEvent } from '@/lib/db';

const NOOK_FUNCTION_TOOLS = [
  {
    name: 'web_search',
    description: 'Searches live technical documentation, encyclopedic articles, and real-time releases.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The search query or technical keywords' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Navigates to an authorized web URL on the agent computer, extracting verified readable text and DOM headings.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Full HTTPS target URL to browse' },
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
    parameters: {
      type: 'OBJECT',
      properties: {
        expression: { type: 'STRING', description: 'Mathematical expression e.g. 2 * 3.14159 * 5' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'request_command_execution',
    description: 'Prepares a shell command for isolated execution in the sandbox, registering a human approval card on the server.',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Terminal command string to run inside the isolated sandbox' },
        title: { type: 'STRING', description: 'Descriptive title for human reviewer' },
      },
      required: ['command'],
    },
  },
  {
    name: 'create_document_draft',
    description: 'Drafts a publication-grade markdown document for living spaces and registers an approval request on the server.',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Document title' },
        content: { type: 'STRING', description: 'Markdown body of the document' },
        targetSpaceId: { type: 'STRING', description: 'Target living space ID' },
      },
      required: ['title', 'content'],
    },
  },
];

export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body = await req.json();
    const { agent, userMessage, history, settings } = body;

    if (!userMessage) {
      return NextResponse.json({ error: 'userMessage is required' }, { status: 400 });
    }

    // Strict security boundary: Always use trusted server-side credentials and endpoints.
    // Client-supplied credentials in chat requests are ignored to prevent credential tampering and SSRF.
    const serverSecrets = await loadEncryptedSecrets();
    const geminiKey = (serverSecrets.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
    const openaiKey = (serverSecrets.openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
    const anthropicKey = (serverSecrets.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '').trim();
    const ollamaUrl = (serverSecrets.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').trim();

    const provider = settings?.provider || 'simulation';

    // ----------------------------------------------------
    // 1. Google Gemini Provider with Tool Support
    // ----------------------------------------------------
    if (provider === 'gemini') {
      if (!geminiKey) {
        return NextResponse.json({
          error: 'Gemini API key is not configured on the server. Please configure it in Settings.',
        }, { status: 400 });
      }

      const model = settings?.model || 'gemini-1.5-flash';
      if (!SUPPORTED_MODELS.gemini.includes(model)) {
        return NextResponse.json({
          error: `Model '${model}' is not a recognized Gemini model. Supported: ${SUPPORTED_MODELS.gemini.join(', ')}`,
        }, { status: 400 });
      }

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: `${agent?.systemPrompt || 'You are an AI coworker'}\nYou have access to an agent computer (browser, terminal, files). Propose review cards for mutating actions.` }]
              },
              tools: [{
                functionDeclarations: NOOK_FUNCTION_TOOLS,
              }],
              contents: [
                ...(history || []).slice(-6).map((m: any) => ({
                  role: m.sender === 'user' ? 'user' : 'model',
                  parts: [{ text: m.content }],
                })),
                { role: 'user', parts: [{ text: userMessage }] }
              ],
            }),
          }
        );

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          logAuditEvent('LLM_PROVIDER_FAIL', `Gemini HTTP ${geminiRes.status}: ${errText.slice(0, 200)}`, 'error', agent?.id);
          return NextResponse.json({
            error: `Gemini API error (HTTP ${geminiRes.status}): ${errText.slice(0, 300)}`,
          }, { status: 502 });
        }

        const data = await geminiRes.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0];
        let toolCall: { name: string; arguments: Record<string, unknown> } | undefined;
        let reply = '';

        if (candidate?.functionCall) {
          toolCall = {
            name: candidate.functionCall.name,
            arguments: candidate.functionCall.args || {},
          };
          reply = `Invoking tool \`${candidate.functionCall.name}\` for objective: "${userMessage}"`;
        } else {
          reply = candidate?.text || 'No response from model.';
        }

        return NextResponse.json({
          reply,
          toolCall,
          provider: 'gemini',
          model,
          thoughtProcess: [`Dispatched to Gemini (${model}) via secure server API`, toolCall ? `Model issued tool call: ${toolCall.name}` : 'Generated text response'],
        });
      } catch (err: any) {
        logAuditEvent('LLM_NETWORK_FAIL', `Gemini network error: ${err.message}`, 'error', agent?.id);
        return NextResponse.json({
          error: `Failed to connect to Google Gemini service: ${err.message}`,
        }, { status: 502 });
      }
    }

    // ----------------------------------------------------
    // 2. OpenAI Provider with Tool Support
    // ----------------------------------------------------
    if (provider === 'openai') {
      if (!openaiKey) {
        return NextResponse.json({
          error: 'OpenAI API key is not configured on the server. Please configure it in Settings.',
        }, { status: 400 });
      }

      // Security Guard: Enforce strict credential ownership (Gemini keys must never reach api.openai.com)
      if (openaiKey.startsWith('AIza')) {
        return NextResponse.json({
          error: 'Credential routing error: Gemini API key provided for OpenAI provider. Cross-provider secret flow is blocked.',
        }, { status: 400 });
      }

      const model = settings?.model || 'gpt-4o-mini';
      if (!SUPPORTED_MODELS.openai.includes(model)) {
        return NextResponse.json({
          error: `Model '${model}' is not a recognized OpenAI model. Supported: ${SUPPORTED_MODELS.openai.join(', ')}`,
        }, { status: 400 });
      }

      const openAiTools = NOOK_FUNCTION_TOOLS.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(t.parameters.properties).map(([k, v]) => [
                k,
                { type: (v as any).type.toLowerCase(), description: (v as any).description },
              ])
            ),
            required: t.parameters.required,
          },
        },
      }));

      try {
        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model,
            tools: openAiTools,
            messages: [
              { role: 'system', content: agent?.systemPrompt || 'You are an AI coworker with access to tools.' },
              ...(history || []).slice(-6).map((m: any) => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.content,
              })),
              { role: 'user', content: userMessage },
            ],
          }),
        });

        if (!openaiRes.ok) {
          const errText = await openaiRes.text();
          logAuditEvent('LLM_PROVIDER_FAIL', `OpenAI HTTP ${openaiRes.status}: ${errText.slice(0, 200)}`, 'error', agent?.id);
          return NextResponse.json({
            error: `OpenAI API error (HTTP ${openaiRes.status}): ${errText.slice(0, 300)}`,
          }, { status: 502 });
        }

        const data = await openaiRes.json();
        const choice = data.choices?.[0]?.message;
        let toolCall: { name: string; arguments: Record<string, unknown> } | undefined;
        let reply = choice?.content || '';

        if (choice?.tool_calls && choice.tool_calls.length > 0) {
          const rawCall = choice.tool_calls[0];
          try {
            toolCall = {
              name: rawCall.function.name,
              arguments: JSON.parse(rawCall.function.arguments || '{}'),
            };
            if (!reply) {
              reply = `Selected autonomous tool \`${toolCall.name}\` to perform task.`;
            }
          } catch {
            // ignore JSON parse error
          }
        }

        return NextResponse.json({
          reply: reply || 'Completed tool evaluation.',
          toolCall,
          provider: 'openai',
          model,
          thoughtProcess: [`Dispatched to OpenAI (${model}) via secure server API`, toolCall ? `Model selected tool: ${toolCall.name}` : 'Generated text reply'],
        });
      } catch (err: any) {
        logAuditEvent('LLM_NETWORK_FAIL', `OpenAI network error: ${err.message}`, 'error', agent?.id);
        return NextResponse.json({
          error: `Failed to connect to OpenAI service: ${err.message}`,
        }, { status: 502 });
      }
    }

    // ----------------------------------------------------
    // 3. Anthropic Claude Provider
    // ----------------------------------------------------
    if (provider === 'anthropic') {
      if (!anthropicKey) {
        return NextResponse.json({
          error: 'Anthropic API key is not configured on the server. Please configure it in Settings.',
        }, { status: 400 });
      }

      const model = settings?.model || 'claude-3-5-sonnet-20241022';
      if (!SUPPORTED_MODELS.anthropic.includes(model)) {
        return NextResponse.json({
          error: `Model '${model}' is not a recognized Anthropic model. Supported: ${SUPPORTED_MODELS.anthropic.join(', ')}`,
        }, { status: 400 });
      }

      try {
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: agent?.systemPrompt || 'You are an autonomous AI coworker.',
            messages: [
              ...(history || []).slice(-6).map((m: any) => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.content,
              })),
              { role: 'user', content: userMessage },
            ],
          }),
        });

        if (!anthropicRes.ok) {
          const errText = await anthropicRes.text();
          logAuditEvent('LLM_PROVIDER_FAIL', `Anthropic HTTP ${anthropicRes.status}: ${errText.slice(0, 200)}`, 'error', agent?.id);
          return NextResponse.json({
            error: `Anthropic API error (HTTP ${anthropicRes.status}): ${errText.slice(0, 300)}`,
          }, { status: 502 });
        }

        const data = await anthropicRes.json();
        const reply = data.content?.[0]?.text || 'No response from model.';
        return NextResponse.json({
          reply,
          provider: 'anthropic',
          model,
          thoughtProcess: [`Dispatched to Anthropic (${model}) via secure server API`, 'Synthesized reply with safety guidelines'],
        });
      } catch (err: any) {
        logAuditEvent('LLM_NETWORK_FAIL', `Anthropic network error: ${err.message}`, 'error', agent?.id);
        return NextResponse.json({
          error: `Failed to connect to Anthropic service: ${err.message}`,
        }, { status: 502 });
      }
    }

    // ----------------------------------------------------
    // 4. Local Ollama Provider
    // ----------------------------------------------------
    if (provider === 'ollama') {
      const model = settings?.model || 'llama3.2';
      try {
        const ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: 'system', content: agent?.systemPrompt || 'You are an AI coworker' },
              ...(history || []).slice(-6).map((m: any) => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.content,
              })),
              { role: 'user', content: userMessage },
            ],
          }),
        });

        if (!ollamaRes.ok) {
          const errText = await ollamaRes.text();
          logAuditEvent('LLM_PROVIDER_FAIL', `Ollama HTTP ${ollamaRes.status}: ${errText.slice(0, 200)}`, 'error', agent?.id);
          return NextResponse.json({
            error: `Ollama inference error (HTTP ${ollamaRes.status}): ${errText.slice(0, 300)}`,
          }, { status: 502 });
        }

        const data = await ollamaRes.json();
        const reply = data.message?.content || 'No response from local Ollama.';
        return NextResponse.json({
          reply,
          provider: 'ollama',
          model,
          thoughtProcess: [`Dispatched to local Ollama (${model})`, 'Generated local inference response'],
        });
      } catch (err: any) {
        logAuditEvent('LLM_NETWORK_FAIL', `Ollama network error: ${err.message}`, 'error', agent?.id);
        return NextResponse.json({
          error: `Failed to connect to local Ollama daemon at ${ollamaUrl}: ${err.message}`,
        }, { status: 502 });
      }
    }

    // ----------------------------------------------------
    // 5. Simulation / Autonomous Engine (Explicitly Marked)
    // ----------------------------------------------------
    return NextResponse.json({
      status: 'ok',
      engine: 'autonomous_client_engine',
      isSimulation: true,
      simulationNotice: 'Running in zero-key demonstration mode. Real model calls require configuring provider keys in Settings.',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
