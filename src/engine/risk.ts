import { tools } from "../polymarket/client";
import { executeSell } from "./executor";
import { Strategy } from "../ai/strategy";

const USER = process.env.WALLET_ADDRESS!;
const redeemed = new Set<string>();

export async function riskLoop(strategy: Strategy) {
  const res = await tools.callTools([
    {
      id: "positions",
      type: "function",
      function: {
        name: "polymarket--127--getUserPositions",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            user: USER,
            limit: 50,
          }),
        }),
      },
    },
  ]);

  const data = JSON.parse(res[0].content ?? "{}");
  const positions = data.payload ?? [];

  console.log("[RISK] positions:", positions);

  for (const p of positions) {
    const tokenId = p.asset;
    const size = Number(p.size);

    if (!tokenId || !size) continue;
    if (p.redeemable) {
      if (redeemed.has(tokenId)) {
        continue;
      }

      console.log("REDEEMING:", p.title);
      redeemed.add(tokenId);

      await tools.callTools([
        {
          id: `redeem-${tokenId}`,
          type: "function",
          function: {
            name: "polymarket--127--redeemPosition",
            arguments: JSON.stringify({
              payload: JSON.stringify({
                conditionId: p.conditionId,
                outcomeIndex: p.outcomeIndex,
                currentValue: Number(p.currentValue ?? 0),
                negativeRisk: Boolean(p.negativeRisk),
              }),
            }),
          },
        },
      ]);

      continue;
    }
    const avg = Number(p.avgPrice);
    const price = Number(p.curPrice);

    if (!avg || !price) continue;

    const pnl = (price - avg) / avg;

    if (pnl <= strategy.stopLoss) {
      console.log("CUTLOSS:", p.title, pnl);
      await executeSell(tokenId, size, price);
    }

    if (pnl >= strategy.takeProfit) {
      console.log("TAKE PROFIT:", p.title, pnl);
      await executeSell(tokenId, size, price);
    }

  }
}
