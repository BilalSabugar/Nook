import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent, userMessage, history, settings } = body;

    if (!userMessage) {
      return NextResponse.json({ error: 'userMessage is required' }, { status: 400 });
    }

    // Server-side fallback API keys if provided via .env
    const geminiKey = process.env.GEMINI_API_KEY || settings?.geminiApiKey;
    const openaiKey = process.env.OPENAI_API_KEY || settings?.openaiApiKey;
    const anthropicKey = process.env.ANTHROPIC_API_KEY || settings?.anthropicApiKey;
    const ollamaUrl = process.env.OLLAMA_BASE_URL || settings?.ollamaEndpoint || 'http://localhost:11434';

    // 1. Google Gemini Provider
    if (geminiKey && (settings?.provider === 'gemini' || process.env.GEMINI_API_KEY)) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: `${agent?.systemPrompt || 'You are an AI coworker'}\nYou have access to an agent computer (browser, terminal, files). Propose review cards for mutating actions.` }]
              },
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

        if (geminiRes.ok) {
          const data = await geminiRes.json();
          const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from model.';
          return NextResponse.json({
            reply,
            thoughtProcess: ['Dispatched to Gemini 1.5 Flash via server API route', 'Evaluated system instructions and returned output'],
          });
        }
      } catch (err) {
        console.error('Server-side Gemini call error:', err);
      }
    }

    // 2. OpenAI Provider
    if (openaiKey && (settings?.provider === 'openai' || process.env.OPENAI_API_KEY)) {
      try {
        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: settings?.model || 'gpt-4o-mini',
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

        if (openaiRes.ok) {
          const data = await openaiRes.json();
          const reply = data.choices?.[0]?.message?.content || 'No response from model.';
          return NextResponse.json({
            reply,
            thoughtProcess: ['Dispatched to OpenAI via server API route', 'Evaluated context and returned output'],
          });
        }
      } catch (err) {
        console.error('Server-side OpenAI call error:', err);
      }
    }

    // 3. Anthropic Claude Provider
    if (anthropicKey && (settings?.provider === 'anthropic' || process.env.ANTHROPIC_API_KEY)) {
      try {
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: settings?.model || 'claude-3-5-sonnet-20241022',
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

        if (anthropicRes.ok) {
          const data = await anthropicRes.json();
          const reply = data.content?.[0]?.text || 'No response from model.';
          return NextResponse.json({
            reply,
            thoughtProcess: ['Dispatched to Anthropic Claude via server API route', 'Synthesized reply with safety guidelines'],
          });
        }
      } catch (err) {
        console.error('Server-side Anthropic call error:', err);
      }
    }

    // 4. Local Ollama Provider
    if (settings?.provider === 'ollama') {
      try {
        const ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings?.model || 'llama3.2',
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

        if (ollamaRes.ok) {
          const data = await ollamaRes.json();
          const reply = data.message?.content || 'No response from local Ollama.';
          return NextResponse.json({
            reply,
            thoughtProcess: ['Dispatched to Local Ollama endpoint', 'Generated local inference response'],
          });
        }
      } catch (err) {
        console.error('Server-side Ollama call error:', err);
      }
    }

    // Default acknowledgment for autonomous client fallback
    return NextResponse.json({
      status: 'ok',
      engine: 'autonomous_client_engine',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
