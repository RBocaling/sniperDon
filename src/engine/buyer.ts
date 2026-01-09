import OpenAI from "openai";
import { tools, txnApi, wallet, LIVE } from "../polymarket/client";

const ai = new OpenAI({
  apiKey: process.env.GROK_API_KEY!,
  baseURL: "https://api.x.ai/v1",
});

const AI_PROMPT = `
You are a Polymarket research analyst.

Focus ONLY on:
- sports
- entertainment
- politics

Ignore permanently:
- crypto price up/down
- weather
- <15-minute markets

For the top 15–20 most liquid markets:
- Research quickly (news / X / recent events)
- Estimate true probability
- Compare vs market price

Return STRICT JSON ONLY:

{
  "buys": [
    {
      "tokenId": string,
      "confidence": number,
      "reason": string
    }
  ]
}

Rules:
- Max 1 buy
- confidence >= 0.65
- No execution
- No sell
`;

export async function autoBuy() {
  const scan = await tools.callTools([
    {
      id: "scan",
      type: "function",
      function: {
        name: "polymarket--127--searchPolymarketMarkets",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            active: true,
            sort: "liquidity",
            limit: 30,
          }),
        }),
      },
    },
  ]);

  const markets = JSON.parse(scan[0].content ?? "{}").payload ?? [];

  const aiRes = await ai.chat.completions.create({
    model: "grok-4-1-fast-reasoning",
    temperature: 0.1,
    max_tokens: 300,
    messages: [
      { role: "system", content: AI_PROMPT },
      { role: "user", content: JSON.stringify(markets) },
    ],
  });

  const decision = JSON.parse(aiRes.choices[0].message.content ?? "{}");
  const pick = decision?.buys?.[0];

  console.log("pick", pick);
  
  if (!pick) return;

  const market = markets.find((m: any) =>
    JSON.parse(m.clobTokenIds || "[]").includes(pick.tokenId)
  );
  if (!market) return;

  console.log("market", market);
  
  const price = Number(market.lastTradePrice);
  if (!price || price <= 0 || price >= 1) return;

  const USD_PER_TRADE = 5;
  const size = Math.ceil(USD_PER_TRADE / price);

  if (!LIVE) {
    console.log("[SIM BUY]", pick.tokenId, size, pick.reason);
    return;
  }

  const buyRes = await tools.callTools([
    {
      id: `buy-${Date.now()}`,
      type: "function",
      function: {
        name: "polymarket--127--marketOrderBuy",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            tokenId: pick.tokenId,
            size,
            orderType: "FAK",
          }),
        }),
      },
    },
  ]);

  console.log("buyRes", buyRes);
  
  const txId = JSON.parse(buyRes[0].content ?? "{}")?.payload?.txId;
  if (!txId) return;

  await txnApi.signAndSendTransaction(txId, {
    address: wallet.address,
    sendTransaction: (tx) => wallet.sendTransaction(tx),
    signTypedData: wallet.signTypedData.bind(wallet),
  });

  console.log("✅ BOUGHT:", market.title);
}
