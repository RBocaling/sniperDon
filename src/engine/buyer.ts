import { tools, txnApi, wallet, LIVE } from "../polymarket/client";
import { Strategy } from "../ai/strategy";

export async function autoBuy(strategy: Strategy) {
  const res = await tools.callTools([
    {
      id: "scan",
      type: "function",
      function: {
        name: "polymarket--127--searchPolymarketMarkets",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            active: true,
            limit: 20,
            sort: "liquidity",
          }),
        }),
      },
    },
  ]);

  const data = JSON.parse(res[0].content ?? "{}");
  const markets = data.payload ?? [];

  console.log("[SCAN] markets length:", markets.length);

  for (const m of markets) {
    if (m.ready === false) continue;
    if (m.restricted === true) continue;
    if (!m.acceptingOrders) continue;
    if (m.closed) continue;
    if (!m.enableOrderBook) continue;

    const liquidity = Number(m.liquidityNum ?? m.liquidity);
    if (liquidity < 8_000) continue;

    let tokenIds: string[] = [];
    try {
      tokenIds = JSON.parse(m.clobTokenIds ?? "[]");
    } catch {
      continue;
    }

    const tokenId = tokenIds[0];
    if (!tokenId) continue;

    const price = Number(m.lastTradePrice);
    if (!price || price <= 0 || price >= 1) continue;

    const edge = strategy.minEdge;
    if (price + edge <= price) continue;

    console.log(
      `[CHECK] ${
        m.question ?? m.title ?? m.slug
      } price=${price} edge=${edge} liquidity=${liquidity}`
    );

    const size = Math.max(strategy.maxTradePct, Number(m.orderMinSize || 5));

    if (!LIVE) {
      console.log("[SIM BUY]", tokenId, size);
      continue;
    }

    const buyRes = await tools.callTools([
      {
        id: `buy-${Date.now()}`,
        type: "function",
        function: {
          name: "polymarket--127--marketOrderBuy",
          arguments: JSON.stringify({
            payload: JSON.stringify({
              tokenId,
              size,
              orderType: "FAK",
            }),
          }),
        },
      },
    ]);

    const parsed = JSON.parse(buyRes[0]?.content ?? "{}");
    const txId = parsed?.payload?.txId;

    if (!txId) {
      console.log("[SKIP BUY] Market not executable via API");
      continue;
    }

    await txnApi.signAndSendTransaction(txId, {
      address: wallet.address,
      sendTransaction: (tx) => wallet.sendTransaction(tx),
      signTypedData: wallet.signTypedData.bind(wallet),
    });

    console.log("✅ BOUGHT:", m.question ?? m.title);
  }
}
