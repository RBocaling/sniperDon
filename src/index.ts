import "dotenv/config";
import { loadStrategy } from "./ai/strategy";
import { autoBuy } from "./engine/buyer";
import { riskLoop } from "./engine/risk";

let strategy: any;

async function main() {
  console.log("🚀 Booting FULL AUTO AI Trader");

  strategy = await loadStrategy();
  console.log("Strategy:", strategy);

  setInterval(() => autoBuy(strategy).catch(console.error), 2 * 60 * 1000);
  setInterval(() => riskLoop(strategy).catch(console.error), 30 * 1000);

  setInterval(async () => {
    strategy = await loadStrategy();
    console.log("Strategy updated:", strategy);
  }, 60 * 60 * 1000);
}

main().catch(console.error);
