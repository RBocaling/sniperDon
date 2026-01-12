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
  "50499856365989370666079231266113357643136414874334810988505960305486995982537";

const CONDITION_ID =
  "0xc08163ba02ba299f6373c4352f2af7229f7bc5bae046d11d57a368083fb9a5f6";

const CURRENT_VALUE = 0.006665;
const OUTCOME_INDEX = 0;
const NEGATIVE_RISK = false;
/**
 * =================
 */

async function manualRedeem() {
  console.log("👛 Wallet:", wallet.address);
  console.log("🟡 MANUAL REDEEM START");

  const res = await tools.callTools([
    {
      id: `redeem-${Date.now()}`,
      type: "function",
      function: {
        name: "polymarket--127--redeemPosition",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            tokenId: TOKEN_ID,
            conditionId: CONDITION_ID,
            currentValue: CURRENT_VALUE,
            outcomeIndex: OUTCOME_INDEX,
            negativeRisk: NEGATIVE_RISK,
          }),
        }),
      },
    },
  ]);

  const parsed = JSON.parse(res[0].content ?? "{}");
  const txId = parsed?.payload?.txId;

  if (!txId) {
    throw new Error("No txId returned from redeem");
  }

  await txnApi.signAndSendTransaction(txId, {
    address: wallet.address,
    sendTransaction: (tx) => wallet.sendTransaction(tx),
    signTypedData: wallet.signTypedData.bind(wallet),
  });

  console.log("✅ REDEEM CONFIRMED & SIGNED:", txId);
}

manualRedeem().catch((e) => {
  console.error("❌ ERROR:", e.message ?? e);
  process.exit(1);
});
