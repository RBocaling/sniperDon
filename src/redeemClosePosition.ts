import { config } from 'dotenv';
import OpenAI from 'openai';
import { Tools, TransactionAPI } from 'unifai-sdk';
import { Wallet, JsonRpcProvider } from 'ethers';
import { formatEther, parseEther } from 'ethers'; 

config(); 

const UNIFAI_KEY = process.env.UNIFAI_AGENT_API_KEY!;
const LLM_KEY = process.env.GROK_API_KEY || process.env.ANTHROPIC_API_KEY!;
const PRIVATE_KEY = process.env.POLYGON_PRIVATE_KEY!;
const MAX_TRADE_USD = parseFloat(process.env.MAX_TRADE_USD || '100');
const MIN_BALANCE_USD = parseFloat(process.env.MIN_BALANCE_USD || '500');
const RPC_URL = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e on Polygon
const dryRun = false; // Set true to simulate (no real txns)

const tools = new Tools({ apiKey: UNIFAI_KEY });
const txnApi = new TransactionAPI({ apiKey: UNIFAI_KEY });

const provider = new JsonRpcProvider(RPC_URL);
const wallet = new Wallet(PRIVATE_KEY, provider);

const client = new OpenAI({
  apiKey: LLM_KEY,
  baseURL:'https://api.x.ai/v1',
});

const SYSTEM_PROMPT = `ONE-TIME INSTANT CASH-OUT — LIQUIDATE EVERYTHING RIGHT NOW!

CURRENT TIME: ${new Date().toUTCString()} (UTC)

MANDATORY TASK THIS CYCLE ONLY:
1. Call getUserPositions → list ALL positions (resolved or open)
2. FOR EVERY SINGLE POSITION:
   - If market is resolved → IMMEDIATELY redeemPosition (full amount)
   - If market is still open → IMMEDIATELY marketOrderSell(tokenId, 100% of current value, "FAK")
3. Keep doing this until ZERO positions left
4. Final step: Call getWalletTokens → show exact USDC.e balance

DO NOT MAKE ANY NEW TRADES.
DO NOT WAIT FOR ANYTHING.
JUST CASH OUT EVERYTHING NOW.

Output format:
"INSTANT CASH-OUT STARTED..."
"REDEEMED — Wild vs Penguins — +$102 profit → USDC.e"
"SOLD — UFC Hooker vs Tsarukyan — $58 → USDC.e"
"ALL POSITIONS CLOSED — FINAL CASH: ~$250 USDC.e"

Wallet: ${wallet.address}
Tools: full dynamic + static ["127"]`;

async function runCycle() {
  console.log(`\n=== Cycle Start: ${new Date().toISOString()} | Wallet: ${wallet.address} ===`);

  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Execute full cycle: Check balance, analyze top markets, decide/trade. Balance threshold: $${MIN_BALANCE_USD}. Max trade: $${MAX_TRADE_USD}.` },
  ];

  const availableTools = await tools.getTools({
    dynamicTools: false,
    staticToolkits: ['127'], // Polymarket toolkit
  });

  let cycleComplete = false;
  while (!cycleComplete) {
    const resp = await client.chat.completions.create({
      model: 'grok-4-1-fast-reasoning',
      messages,
      tools: availableTools,
      temperature: 0.3, 
      max_tokens: 2000,
    });

    const msg = resp.choices[0].message;
    messages.push(msg);

    if (msg.content) {
      console.log('🤖 AI Decision:', msg.content);
      if (msg.content.includes('INSUFFICIENT_BALANCE')) {
        console.log('⚠️ Skipping: Low balance.');
        return;
      }
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      cycleComplete = true;
      break;
    }

    console.log(`🔧 Calling ${msg.tool_calls.length} tools...`);

    // Execute Tool Calls
  const toolResults = await tools.callTools(msg.tool_calls);
    for (const r of toolResults) {
  if (typeof r.content === "string" && r.content.includes("txId")) {
    const payload = JSON.parse(r.content).payload;
    const txId = payload.txId;
    if (txId) {
      console.log("Executing txId:", txId);
      try {
        const sent = await txnApi.signAndSendTransaction(txId, {
          address: wallet.address,
          sendTransaction: async (tx: any) => {
            if (tx.gasLimit) {
              const limit = BigInt(tx.gasLimit);
              if (limit > 7_000_000n) {
                tx.gasLimit = 7_000_000;
                console.log(`Gas capped 7M ← was ${limit}`);
              }
            }
            return await wallet.sendTransaction(tx);
          },
          signTypedData: wallet.signTypedData.bind(wallet),
        });
        console.log("SUCCESS Tx:", `https://polygonscan.com/tx/${sent.hash?.[0]}`);
      } catch (e: any) {
        console.log("Tx failed (will retry next cycle):", e.message);
      }
    }
  }
}

    messages.push(...toolResults);
  }

  console.log('=== Cycle End ===\n');
}
setInterval(runCycle, 5 * 60 * 1000);
runCycle(); 

console.log('🚀 Polymarket Agent Live! Press Ctrl+C to stop.');