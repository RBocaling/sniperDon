import "dotenv/config";
import { Tools, TransactionAPI } from "unifai-sdk";
import { Wallet, JsonRpcProvider } from "ethers";

const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY! });
const txnApi = new TransactionAPI({
  apiKey: process.env.UNIFAI_AGENT_API_KEY!,
});

const provider = new JsonRpcProvider(process.env.POLYGON_RPC!);
const wallet = new Wallet(process.env.POLYGON_PRIVATE_KEY!, provider);

/**
 * 🔧 EDIT ONLY THESE
 */
const TOKEN_ID =
  "6198661827519197353016523612427764952648645792320037235664358818920579829837";

const SIZE = 46.875;
/**
 * =================
 */

async function manualSell() {
  console.log("👛 Wallet:", wallet.address);
  console.log("🟡 MANUAL SELL START");
  console.log("Token:", TOKEN_ID);
  console.log("Size:", SIZE);

  const res = await tools.callTools([
    {
      id: `sell-${Date.now()}`,
      type: "function",
      function: {
        name: "polymarket--127--marketOrderSell",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            tokenId: TOKEN_ID,
            size: SIZE,
            orderType: "FAK",
          }),
        }),
      },
    },
  ]);

  const parsed = JSON.parse(res[0].content ?? "{}");
  const txId = parsed?.payload?.txId;

  if (!txId) {
    throw new Error("No txId returned from sell");
  }

  await txnApi.signAndSendTransaction(txId, {
    address: wallet.address,
    sendTransaction: (tx) => wallet.sendTransaction(tx),
    signTypedData: wallet.signTypedData.bind(wallet),
  });

  console.log("✅ SELL CONFIRMED & SIGNED:", txId);
}

manualSell().catch((e) => {
  console.error("❌ ERROR:", e.message ?? e);
  process.exit(1);
});
