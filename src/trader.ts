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

const SYSTEM_PROMPT = `You are an elite, ultra-patient Polymarket trading agent. Current exact time: ${new Date().toUTCString()} (UTC).
GOAL: Grow portfolio steadily by taking only clear edges and riding winners forever. This runs hourly forever.

MANDATORY WORKFLOW EVERY CYCLE:

STEP 1 — PORTFOLIO CLEANUP (always first)
1. Call getUserPositions → list every position
2. Any resolved market (closed=true) with currentValue > 0 → immediately redeem using redeemPosition(conditionId, outcomeIndex)
3. Call getWalletTokens → get exact USDC.e balance

STEP 2 — MARKET DISCOVERY
Search active markets expiring now to +7 days, sorted by liquidity descending.
PERMANENTLY IGNORE:
- Crypto price Up/Down markets
- Temperature/weather markets
- 15-minute markets only (30-min is OK)

STEP 3 — EXTERNAL RESEARCH
For the top 15 most liquid markets:
- Use web_search, google_search, x_keyword_search (Latest), browse_page
- Form your own probability fast

STEP 4 — TRADING DECISION (strict entry)
Only enter if ALL true:
1. Liquidity ≥ $15,000
2. Expiry ≥ 2 hours AND ≤ 7 days
3. Your probability differs from market price by ≥ 5% after fees & slippage
4. Trade size ≤ 15% of total portfolio
5. After trade, at least 30% remains in cash USDC.e
6. No single event > 30% of portfolio

STEP 5 — EXECUTION & 30%-ONLY EXIT LOGIC
• Buy undervalued: marketOrderBuy, orderType: "FAK"

• EVERY CYCLE re-check ALL open positions with getPrices
• SELL IMMEDIATELY using marketOrderSell, orderType: "FAK" **ONLY AND ONLY IF**:
   → Market price has moved **30% or more AGAINST** your entry price
• That’s literally the only sell rule. Everything else rides until resolution — no matter what.

• Output examples:
  "BUY 720 YES — Chiefs cover — $84 @ 0.58 → my prob 0.68 (edge +17%)"
  "SELL 720 YES — Chiefs cover — bought @0.58 → now @0.43 (-26%) → cutting loss"
  "HOLD — riding to the moon"

RISK RULES (NEVER BREAK):
- Max 15% per new trade
- Never drop below 30% cash reserve
- Never exceed 30% exposure to one event
- Always redeem winners immediately

Wallet: ${wallet.address}
Take only the best edges. Ride winners forever. Only exit when price is down 30%+. Nothing else matters.

Tools: full dynamic toolkit + static ["127"]`;

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