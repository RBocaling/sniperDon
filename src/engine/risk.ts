import { tools } from "../polymarket/client";
import { executeSell } from "./executor";

const USER = process.env.WALLET_ADDRESS!;
const STOP_LOSS = -0.3;
const TAKE_PROFIT = 0.5;

export async function riskLoop() {
  const res = await tools.callTools([
    {
      id: "positions",
      type: "function",
      function: {
        name: "polymarket--127--getUserPositions",
        arguments: JSON.stringify({
          payload: JSON.stringify({ user: USER, limit: 50 }),
        }),
      },
    },
  ]);

  const positions = JSON.parse(res[0].content ?? "{}").payload ?? [];

  for (const p of positions) {
    if (!p.asset || !p.size) continue;

    if (p.redeemable) continue;

    const avg = Number(p.avgPrice);
    const price = Number(p.curPrice);
    if (!avg || !price) continue;

    const pnl = (price - avg) / avg;

    if (pnl <= STOP_LOSS || pnl >= TAKE_PROFIT) {
      console.log("⚠️ EXIT:", p.title, pnl);
      await executeSell(p.asset, Number(p.size), price);
    }
  }
}
