import "dotenv/config";
import { Tools, TransactionAPI } from "unifai-sdk";
import { Wallet, JsonRpcProvider, Contract } from "ethers";

const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY! });
const txnApi = new TransactionAPI({
  apiKey: process.env.UNIFAI_AGENT_API_KEY!,
});

const provider = new JsonRpcProvider(process.env.POLYGON_RPC!);
const wallet = new Wallet(process.env.POLYGON_PRIVATE_KEY!, provider);

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);

const CYCLE_INTERVAL_MS = 120_000;

const TRADE_USD = 1;
const USDC_DECIMALS = 6;
const MIN_USDC_BUFFER = 1;

const MIN_LIQ = 6_000;
const MIN_PRICE = 0.06;
const MAX_PRICE = 0.8;
const MAX_SPREAD = 0.015;
const MIN_24H_VOL = 1_000;

const EDGE_THRESHOLD = 0.07;

// const TP = 2.0;
const SL = -0.3;
const MIN_SELL_VALUE = 1;

const isNum = (v: any) => typeof v === "number" && Number.isFinite(v);
const pct = (cur: number, avg: number) => (cur - avg) / avg;

async function getUsdcBalance(): Promise<number> {
  const raw = await usdc.balanceOf(wallet.address);
  return Number(raw) / 10 ** USDC_DECIMALS;
}

async function getActivePositions() {
  const res = await tools.callTools([
    {
      id: "positions",
      type: "function",
      function: {
        name: "polymarket--127--getUserPositions",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            user: wallet.address,
            limit: 100,
          }),
        }),
      },
    },
  ]);

  const raw = JSON.parse(res[0].content ?? "{}").payload;

  return (
    Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.positions)
      ? raw.positions
      : []
  ).filter((p: any) => Number(p.currentValue) > 1);
}
async function getAllPositions() {
  const res = await tools.callTools([
    {
      id: "positions",
      type: "function",
      function: {
        name: "polymarket--127--getUserPositions",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            user: wallet.address,
            limit: 100,
          }),
        }),
      },
    },
  ]);

  const raw = JSON.parse(res[0].content ?? "{}").payload;

  return (
    Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.positions)
      ? raw.positions
      : []
  );
}

function pickTokenId(m: any): string | null {
  if (Array.isArray(m.tokenIds)) return m.tokenIds[0];
  if (Array.isArray(m.clobTokenIds)) return m.clobTokenIds[0];
  if (typeof m.clobTokenIds === "string") {
    try {
      return JSON.parse(m.clobTokenIds)[0];
    } catch {
      return null;
    }
  }
  return null;
}

function computeEdge(m: any): number {
  const price = Number(m.lastTradePrice ?? m.bestAsk ?? m.bestBid);
  if (!isNum(price) || !Array.isArray(m.outcomes)) return 0;
  const fair = 1 / m.outcomes.length;
  return Math.abs(price - fair) / fair;
}

function scoreMarket(m: any): number {
  let s = 0;
  const price = Number(m.lastTradePrice ?? m.bestAsk ?? m.bestBid);
  const spread = Number(m.spread);
  const v24 = Number(m.volume24hr ?? m.volume);

  if (isNum(price) && price >= MIN_PRICE && price <= MAX_PRICE) s++;
  if (isNum(spread) && spread <= MAX_SPREAD) s++;
  if (isNum(v24) && v24 >= MIN_24H_VOL) s++;

  return s;
}

async function scanMarkets(): Promise<any[]> {
  const res = await tools.callTools([
    {
      id: "sports",
      type: "function",
      function: {
        name: "polymarket--127--getEventsByCategory",
        arguments: JSON.stringify({
          payload: JSON.stringify({ category: "sports" }),
        }),
      },
    },
  ]);

  const payload = JSON.parse(res[0].content ?? "{}").payload;
  const events = Array.isArray(payload) ? payload : [];
  

  const now = Date.now();
  const MIN_EXPIRY_MS = 30 * 60 * 1000;
  const MAX_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000;

  const markets = events.flatMap((e: any) => e.markets || []);
  console.log("total market:", markets);

  const filtered =  markets.filter((m: any) => {
    if (!m.active || m.closed || !m.endDate) return false;
    const exp = new Date(m.endDate).getTime();
    if (exp < now + MIN_EXPIRY_MS) return false;
    if (exp > now + MAX_EXPIRY_MS) return false;
    const liq = Number(m.liquidityNum ?? m.liquidity);
    if (!isNum(liq) || liq < MIN_LIQ) return false;
    if (computeEdge(m) < EDGE_THRESHOLD) return false;
    return scoreMarket(m) >= 3;
  });

  console.log("filtered", filtered);
  
  return filtered;
}

async function tryBuy(m: any) {
  const tokenId = pickTokenId(m);
  if (!tokenId) return;

  const positions = await getAllPositions();  

  if (
    positions.some(
      (p: any) =>
        (m.eventId && String(p.eventId) === String(m.eventId)) ||
        (m.eventSlug && p.eventSlug === m.eventSlug)
    )
  ) {
    console.log("⏭️ SKIP (EVENT ALREADY HAS POSITION):", m.title ?? m.question);
    return;
  }

  const balance = await getUsdcBalance();
  console.log("balance", balance);

  if (balance < (TRADE_USD + MIN_USDC_BUFFER)) {
    console.log(`⛔ SKIP BUY (LOW BALANCE): ${balance.toFixed(2)} USDC`);
    return;
  }

  console.log("EDGE:", computeEdge(m), m.question ?? m.title);

  const res = await tools.callTools([
    {
      id: `buy-${Date.now()}`,
      type: "function",
      function: {
        name: "polymarket--127--marketOrderBuy",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            tokenId,
            amount: TRADE_USD,
            orderType: "FOK",
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

  console.log("✅ BUY:", m.question ?? m.title);
}

async function exitByRule(p: any, reason: string) {
  if (p.currentValue < MIN_SELL_VALUE) return;

  if (p.redeemable === true) {
    const res = await tools.callTools([
      {
        id: `redeem-${Date.now()}`,
        type: "function",
        function: {
          name: "polymarket--127--redeemPosition",
          arguments: JSON.stringify({
            payload: JSON.stringify({
              tokenId: p.asset,
              conditionId: p.conditionId,
              currentValue: p.currentValue,
              outcomeIndex: 0,
              negativeRisk: false,
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

    console.log("REDEEM:", reason, p.asset);
    return;
  }

  const res = await tools.callTools([
    {
      id: `sell-${Date.now()}`,
      type: "function",
      function: {
        name: "polymarket--127--marketOrderSell",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            tokenId: p.asset,
            size: p.size,
            orderType: "FOK",
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

  console.log("SELL:", reason, p.asset);
}


function isEventEndedByDate(endDate: string): boolean {
  if (!endDate) return false;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return today > endDate;
}

async function riskLoop() {
  const positions = await getActivePositions();
  console.log("total position", positions.length);
  

  for (const p of positions) {
    const avg = Number(p.avgPrice);
    const cur = Number(p.curPrice);

    if (!isNum(avg) || !isNum(cur)) continue;

    // if (isEventEndedByDate(p.endDate)) {
    //   await exitByRule(p, "EVENT ENDED");
    //   continue;
    // }

    const pnl = pct(cur, avg);

    // if (pnl >= TP) await exitByRule(p, "TAKE PROFIT");
    if (pnl <= SL) await exitByRule(p, "STOP LOSS");
  }
}

async function cycle() {
  await riskLoop();
  const markets = await scanMarkets();
  for (const m of markets) await tryBuy(m);
}

setInterval(cycle, CYCLE_INTERVAL_MS);
cycle();

console.log("Bot is running (SAFE MODE)");
