import { tools, txnApi, wallet, LIVE } from "../polymarket/client";

let locked = false;

export async function executeSell(tokenId: string, size: number) {
  if (!LIVE) {
    console.log("[SIM SELL]", tokenId, size);
    return;
  }

  if (locked) return;
  locked = true;

  try {
    const res = await tools.callTools([
      {
        id: Date.now().toString(),
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

    const txId = JSON.parse(res[0].content!).payload.txId;

    await txnApi.signAndSendTransaction(txId, {
      address: wallet.address,
      sendTransaction: (tx) => wallet.sendTransaction(tx),
      signTypedData: wallet.signTypedData.bind(wallet),
    });

    console.log("SOLD", tokenId);
  } finally {
    locked = false;
  }
}
