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
    const canMarketBuy = m.ready === true && m.restricted === false;
    const canLimitBuy = m.rfqEnabled === true;
    if (!canMarketBuy && !canLimitBuy) continue;

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

    const USD_PER_TRADE = 5; 

    const minSharesByUsd = Math.ceil(USD_PER_TRADE / price);
    const minSharesByMarket = Number(m.orderMinSize || 5);

    const size = Math.max(minSharesByUsd, minSharesByMarket);

    if (!LIVE) {
      console.log("[SIM BUY]", tokenId, size);
      continue;
    }

    let buyRes;

    if (canMarketBuy) {
      buyRes = await tools.callTools([
        {
          id: `mkt-${Date.now()}`,
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
    } else {
      const limitPrice = Number(m.bestAsk ?? price);

      buyRes = await tools.callTools([
        {
          id: `lmt-${Date.now()}`,
          type: "function",
          function: {
            name: "polymarket--127--limitOrderBuy",
            arguments: JSON.stringify({
              payload: JSON.stringify({
                tokenId,
                price: limitPrice,
                size,
                orderType: "GTC",
              }),
            }),
          },
        },
      ]);
    }


    const parsed = JSON.parse(buyRes[0]?.content ?? "{}");
    const txId = parsed?.payload?.txId;

    if (!txId) {
      console.log("[SKIP BUY] No txId", m.question ?? m.title);
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
