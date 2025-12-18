import OpenAI from "openai";

export type Strategy = {
  maxTradePct: number;
  minEdge: number;
  stopLoss: number;
  takeProfit: number;
  maxEventExposure: number;
};

const client = new OpenAI({
  apiKey: process.env.GROK_API_KEY!,
  baseURL: "https://api.x.ai/v1",
});

export async function loadStrategy(): Promise<Strategy> {
  const res = await client.chat.completions.create({
    model: "grok-4-1-fast-reasoning",
    temperature: 0.1,
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content: `
You are a trading parameter generator.
Output STRICT JSON ONLY.
NO nesting.
NO descriptions.
NO arrays.
NO objects.

Return EXACTLY this shape:
{
  "maxTradePct": number,
  "minEdge": number,
  "stopLoss": number,
  "takeProfit": number,
  "maxEventExposure": number
}

Rules:
- stopLoss negative
- takeProfit positive
- maxTradePct 0.05–0.2
- minEdge 0.02–0.06
- maxEventExposure 0.2–0.4
`,
      },
      {
        role: "user",
        content: `Generate parameters for Polymarket trading.`,
      },
    ],
  });

  const raw = res.choices[0].message.content!;
  const parsed = JSON.parse(raw);

  return {
    maxTradePct: Number(parsed.maxTradePct),
    minEdge: Number(parsed.minEdge),
    stopLoss: Number(parsed.stopLoss),
    takeProfit: Number(parsed.takeProfit),
    maxEventExposure: Number(parsed.maxEventExposure),
  };
}
