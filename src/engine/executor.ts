import { tools, txnApi, wallet, LIVE } from "../polymarket/client";

const sellLocks = new Set<string>();

export async function executeSell(
  tokenId: string,
  size: number,
  bestBid?: number
) {
  if (!LIVE) {
    console.log("[SIM SELL]", tokenId, size);
    return;
  }

  if (sellLocks.has(tokenId)) return;
  sellLocks.add(tokenId);

  try {
    // 1️⃣ TRY MARKET SELL (FAST EXIT)
    const marketRes = await tools.callTools([
      {
        id: `sell-mkt-${Date.now()}`,
        type: "function",
        function: {
          name: "polymarket--127--marketOrderSell",
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

    const parsed = JSON.parse(marketRes[0]?.content ?? "{}");
    const txId = parsed?.payload?.txId;

    if (txId) {
      await txnApi.signAndSendTransaction(txId, {
        address: wallet.address,
        sendTransaction: (tx) => wallet.sendTransaction(tx),
        signTypedData: wallet.signTypedData.bind(wallet),
      });

      console.log("✅ SOLD (MARKET)", tokenId);
      return;
    }

    throw new Error("Market sell failed");
  } catch {
    // 2️⃣ FALLBACK → LIMIT SELL
    if (!bestBid) {
      console.log("❌ No bestBid, cannot place limit sell", tokenId);
      return;
    }

   const limitPrice = Math.min(Math.max(bestBid + 0.001, 0.001), 0.999);

   const limitRes = await tools.callTools([
     {
       id: `sell-lmt-${Date.now()}`,
       type: "function",
       function: {
         name: "polymarket--127--limitOrderSell",
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


    const parsed = JSON.parse(limitRes[0]?.content ?? "{}");
    const txId = parsed?.payload?.txId;

    if (txId) {
      await txnApi.signAndSendTransaction(txId, {
        address: wallet.address,
        sendTransaction: (tx) => wallet.sendTransaction(tx),
        signTypedData: wallet.signTypedData.bind(wallet),
      });

      console.log("🟡 LIMIT SELL PLACED", tokenId, "price=", limitPrice);
    } else {
      console.log("❌ LIMIT SELL FAILED", tokenId);
    }
  } finally {
    sellLocks.delete(tokenId);
  }
}
