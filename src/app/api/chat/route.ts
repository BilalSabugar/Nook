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

    // 1. If Gemini Key is present
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
            thoughtProcess: ['Dispatched to Gemini 1.5 Flash via server API route', 'Processed context and returned output'],
          });
        }
      } catch (err) {
        console.error('Server-side Gemini call error:', err);
      }
    }

    // 2. If OpenAI Key is present
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
            thoughtProcess: ['Dispatched to OpenAI via server API route', 'Processed context and returned output'],
          });
        }
      } catch (err) {
        console.error('Server-side OpenAI call error:', err);
      }
    }

    // Default: Return server acknowledgment for client-side engine
    return NextResponse.json({
      status: 'ok',
      engine: 'autonomous_client_engine',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
