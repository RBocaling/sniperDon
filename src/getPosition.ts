import "dotenv/config";
import { Tools } from "unifai-sdk";

const tools = new Tools({
  apiKey: process.env.UNIFAI_AGENT_API_KEY!,
});

const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

async function getPositions() {
  if (!WALLET_ADDRESS) {
    throw new Error("WALLET_ADDRESS is missing in .env");
  }

  const res = await tools.callTools([
    {
      id: "positions",
      type: "function",
      function: {
        name: "polymarket--127--getUserPositions",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            user: WALLET_ADDRESS,
            limit: 100,
          }),
        }),
      },
    },
  ]);

  const payload = JSON.parse(res[0].content ?? "{}").payload;

  const positions = (
    Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.positions)
      ? payload.positions
      : []
  ).filter((p: any) => Number(p.currentValue) > 1);

  if (positions.length === 0) {
    console.log("⚠️ No active positions (currentValue > 1)");
    return;
  }

  console.log(`📦 ACTIVE POSITIONS: ${positions.length}\n`);

  for (const p of positions) {
    console.log({
      title: p.title,
      eventSlug: p.eventSlug,
      eventId: p.eventId,
      tokenId: p.asset,
      conditionId: p.conditionId,
      outcome: p.outcome,
      size: p.size,
      avgPrice: p.avgPrice,
      curPrice: p.curPrice,
      currentValue: p.currentValue,
      percentPnl: p.percentPnl,
      redeemable: p.redeemable,
      endDate: p.endDate,
    });
  }
}

getPositions().catch((e) => {
  console.error("❌ ERROR:", e.message ?? e);
  process.exit(1);
});
