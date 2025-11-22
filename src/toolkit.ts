// toolkit.ts
import { config } from "dotenv";
import { Toolkit, ActionContext } from "unifai-sdk";

config();

async function main() {
  const toolkit = new Toolkit({
    apiKey: process.env.UNIFAI_TOOLKIT_API_KEY || "",
  });

  await toolkit.updateToolkit({
    name: "PolymarketAutoTrader",
    description: "Auto trade Polymarket prediction markets",
  });

  toolkit.event("ready", () => {
    console.log("🔧 Toolkit loaded: PolymarketAutoTrader");
  });

  // ------------------------------
  // MAIN TOOL → Auto-Trade Action
  // ------------------------------
  toolkit.action(
    {
      action: "polymarket_auto_trade",
      actionDescription: "Execute auto trade on Polymarket mainnet",
      payloadDescription: {
        marketId: { type: "string" },
        outcomeId: { type: "string" },
        side: { type: "string" }, // BUY or SELL
        size: { type: "number" }, // USDC amount
      },
    },
    async (ctx: ActionContext, payload: any = {}) => {
      const { marketId, outcomeId, side, size } = payload;

      return ctx.result({
        message: "Polymarket trade created",
        payload: {
          marketId,
          outcomeId,
          side,
          size,
          // The UnifAI transactionAPI will generate txId here
        },
      });
    }
  );

  await toolkit.run();
}

main().catch(console.error);
