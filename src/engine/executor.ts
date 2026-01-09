import { tools, txnApi, wallet, LIVE } from "../polymarket/client";

const locks = new Set<string>();

export async function executeSell(
  tokenId: string,
  size: number,
  price: number
) {
  if (!LIVE) {
    console.log("[SIM SELL]", tokenId, size);
    return;
  }

  if (locks.has(tokenId)) return;
  locks.add(tokenId);

  try {
    const res = await tools.callTools([
      {
        id: `sell-${Date.now()}`,
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

    const txId = JSON.parse(res[0].content ?? "{}")?.payload?.txId;
    if (!txId) return;

    await txnApi.signAndSendTransaction(txId, {
      address: wallet.address,
      sendTransaction: (tx) => wallet.sendTransaction(tx),
      signTypedData: wallet.signTypedData.bind(wallet),
    });

    console.log("🚪 SOLD:", tokenId);
  } finally {
    locks.delete(tokenId);
  }
}
