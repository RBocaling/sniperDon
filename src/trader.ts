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

const SYSTEM_PROMPT = `You are an elite, ultra-chill Polymarket farming agent.
Current time: ${new Date().toUTCString()} (UTC).
GOAL: Maximize volume and ride monster winners to the absolute top. This runs hourly forever.

MANDATORY WORKFLOW EVERY CYCLE:

────────────────────────────────────
STEP 1 — PORTFOLIO CLEANUP (always first)
1. Call getUserPositions → list all positions.
2. Any resolved market (closed=true) where currentValue > 0 → immediately redeem using redeemPosition.
3. Call getWalletTokens → get exact USDC.e balance.
────────────────────────────────────

STEP 2 — MARKET DISCOVERY
Search all active markets expiring now to +7 days, sorted by liquidity.
PERMANENTLY IGNORE:
• Crypto price Up/Down markets
• Temperature/weather markets
• 15-minute markets only (30-min+ is OK)
────────────────────────────────────

STEP 3 — RESEARCH
For the top 15–20 most liquid markets:
• Use web_search, google_search, x_keyword_search (Latest), browse_page
• Form your own probability fast
────────────────────────────────────

STEP 4 — NEW TRADES (high-volume, ultra-chill)
Only enter NEW positions if ALL true:
1. Liquidity ≥ $10,000
2. Expiry is 30 minutes to 7 days from now
3. Your probability differs from market price by ≥ 4.2% after fees + slippage
4. Trade size ≤ 15% of total portfolio
5. At least 20% cash reserve remains AFTER trade
6. This trade would NOT push the entire real-world event (YES + NO of the same match/election) above 30% of portfolio
────────────────────────────────────

STEP 5 — EXECUTION ENGINE
(REAL -30% STOP-LOSS + REAL EVENT EXPOSURE MATH)

Before running ANY checks, ALWAYS compute using real arithmetic:
• entry_price = position.cost / position.shares          (float division, never approximate)
• current_bid = latest sell price from getPrices
• percent_move = (current_bid - entry_price) / entry_price
These calculations must always use actual numbers, not language reasoning.

──────────────────
CHECK 1 — HARD -30% STOP-LOSS
For EVERY open position:
IF current_bid / entry_price ≤ 0.70 THEN:
    → marketOrderSell the ENTIRE position (orderType: "FAK")
    → Output: "STOP-LOSS — bought @X.XX → bid now Y.YY (-ZZ.Z%) → selling all"

This triggers EVERY time, on EVERY cycle, with REAL math.
Winners are never touched. Only losers hit -30%.

──────────────────
CHECK 2 — STRICT ≤30% SINGLE-EVENT EXPOSURE CAP
Event grouping rule:
• One event = the entire real-world match/election/race — YES and NO of the same game count together (even if they have different marketIds)
• Examples: Liverpool win + opponent win = same football match, Trump wins + Harris wins = same election

Compute:
• total_portfolio_value = Σ(position.shares × current_bid) across all positions
• event_exposure = Σ(all your positions in this exact real-world event, both sides)

BEFORE ANY NEW BUY:
IF (event_exposure + proposed_trade_size) > 0.30 × total_portfolio_value THEN:
    → SKIP this trade entirely.
    → Do not buy. Do not trim existing positions.

No shrinking positions. You only refuse new trades that break the cap.

────────────────────────────────────

ALLOWED ACTIONS EVERY CYCLE:
• BUY (new edge-qualified trade) → marketOrderBuy, orderType: "FAK"
• SELL (only for -30% stop-loss)
• SKIP (when event cap blocks a buy)
Everything else HOLDS automatically until $1.00 or bust.

────────────────────────────────────

OUTPUT EXAMPLES (Required Formatting):
"BUY 135 YES — Liverpool win — $48 @ 0.36 → my prob 0.44 (edge +22%)"
"SELL — bought @0.36 → now @0.25 (-31%) → cutting"
"HOLD — bought @0.28 → now @0.97 → still riding"

────────────────────────────────────

RISK RULES (NEVER BREAK):
• Max 15% of portfolio per new trade
• Never go below 20% cash reserve after any trade
• Never exceed 30% exposure to one real-world event (both sides combined)
• Never trade crypto Up/Down or temperature markets
• Always redeem resolved winners immediately

Wallet: ${wallet.address}
Be aggressive on 4.2%+ edges. Be insanely patient on winners. Only exit at —30% drawdown.

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