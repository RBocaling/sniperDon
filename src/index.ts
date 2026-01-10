import "dotenv/config";
import { Tools, TransactionAPI } from "unifai-sdk";
import { Wallet, JsonRpcProvider } from "ethers";

const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY! });
const txnApi = new TransactionAPI({
  apiKey: process.env.UNIFAI_AGENT_API_KEY!,
});

const provider = new JsonRpcProvider(process.env.POLYGON_RPC!);
const wallet = new Wallet(process.env.POLYGON_PRIVATE_KEY!, provider);

const SCAN_INTERVAL_MS = 60_000;
const RISK_INTERVAL_MS = 5_000;

const TRADE_USD = Number(5);

const MIN_LIQ = 6_000;
const MIN_PRICE = 0.06;
const MAX_PRICE = 0.8;
const MAX_SPREAD = 0.015;
const MIN_24H_VOL = 1_000;

const EDGE_THRESHOLD = 0.07;

const TP = 0.7;
const SL = -0.3;
const MIN_SELL_VALUE = 1;

const openPositions = new Set<string>();
const locks = new Set<string>();

const isNum = (v: any) => typeof v === "number" && Number.isFinite(v);
const pct = (cur: number, avg: number) => (cur - avg) / avg;

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
  console.log("total market:", markets.length);

  const filtered = markets.filter((m: any) => {
    if (!m.active || m.closed || !m.endDate) return false;

    const exp = new Date(m.endDate).getTime();
    if (exp < now + MIN_EXPIRY_MS) return false;
    if (exp > now + MAX_EXPIRY_MS) return false;

    const liq = Number(m.liquidityNum ?? m.liquidity);
    if (!isNum(liq) || liq < MIN_LIQ) return false;

    const edge = computeEdge(m);
    if (!isNum(edge) || edge < EDGE_THRESHOLD) return false;

    return scoreMarket(m) >= 3;
  });

  console.log("filtered market:", filtered.length);
  return filtered;
}

async function tryBuy(m: any) {
  const tokenId = pickTokenId(m);
  if (!tokenId) return;
  if (openPositions.has(tokenId)) return;
  if (locks.has(tokenId)) return;

  locks.add(tokenId);

  try {
    const edge = computeEdge(m);
    console.log("EDGE:", edge, m.question ?? m.title);

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
              orderType: "FAK",
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

    openPositions.add(tokenId);
    console.log("✅ BUY:", m.question ?? m.title);
  } catch (e: any) {
    console.error("BUY ERROR:", e?.message ?? e);
  } finally {
    locks.delete(tokenId);
  }
}

async function exitPosition(
  tokenId: string,
  size: number,
  value: number,
  reason: string
) {
  if (locks.has(tokenId)) return;
  if (!isNum(size) || size <= 0) return;
  if (!isNum(value) || value < MIN_SELL_VALUE) return;

  locks.add(tokenId);

  try {
    const res = await tools.callTools([
      {
        id: `sell-${Date.now()}`,
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

    const txId = JSON.parse(res[0].content ?? "{}")?.payload?.txId;
    if (!txId) return;

    await txnApi.signAndSendTransaction(txId, {
      address: wallet.address,
      sendTransaction: (tx) => wallet.sendTransaction(tx),
      signTypedData: wallet.signTypedData.bind(wallet),
    });

    openPositions.delete(tokenId);
    console.log("EXIT:", reason, tokenId);
  } finally {
    locks.delete(tokenId);
  }
}

async function riskLoop() {
  const res = await tools.callTools([
    {
      id: "positions",
      type: "function",
      function: {
        name: "polymarket--127--getUserPositions",
        arguments: JSON.stringify({
          payload: JSON.stringify({
            user: wallet.address,
            limit: 50,
          }),
        }),
      },
    },
  ]);

  const raw = JSON.parse(res[0].content ?? "{}").payload;
  const positions = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.positions)
    ? raw.positions
    : [];

  for (const p of positions) {
    if (!p.asset || !p.size) continue;

    if (p.redeemable) {
      await tools.callTools([
        {
          id: `redeem-${Date.now()}`,
          type: "function",
          function: {
            name: "polymarket--127--redeemPosition",
            arguments: JSON.stringify({
              payload: JSON.stringify({
                conditionId: p.conditionId,
                tokenId: p.asset,
              }),
            }),
          },
        },
      ]);
      openPositions.delete(p.asset);
      console.log("REDEEM:", p.asset);
      continue;
    }

    const avg = Number(p.avgPrice);
    const cur = Number(p.curPrice);
    const val = Number(p.currentValue);
    if (!isNum(avg) || !isNum(cur)) continue;

    const pnl = pct(cur, avg);

    if (pnl >= TP)
      await exitPosition(p.asset, Number(p.size), val, "TAKE PROFIT");
    if (pnl <= SL)
      await exitPosition(p.asset, Number(p.size), val, "STOP LOSS");
  }
}

setInterval(riskLoop, RISK_INTERVAL_MS);
setInterval(async () => {
  const markets = await scanMarkets();
  for (const m of markets) await tryBuy(m);
}, SCAN_INTERVAL_MS);

console.log("Bot is running..");
