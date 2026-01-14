import { JsonRpcProvider, Wallet } from "ethers";
import { Tools } from "unifai-sdk";
const provider = new JsonRpcProvider(process.env.POLYGON_RPC!);

const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY! });
const wallet = new Wallet(process.env.POLYGON_PRIVATE_KEY!, provider);


async function getBuyHistory() {
  const res = await tools.callTools([
    {
      id: "buy-history",
      type: "function",
      function: {
        name: "polymarket--127--getUserTrades",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            user: wallet.address,
            side: "BUY",
            limit: 200,
          }),
        }),
      },
    },
  ]);

  const raw = JSON.parse(res[0].content ?? "{}")?.payload ?? [];

  return Array.isArray(raw) ? raw : [];
}
console.log("tw", getBuyHistory());
