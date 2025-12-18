import { Tools, TransactionAPI } from "unifai-sdk";
import { Wallet, JsonRpcProvider } from "ethers";

export const tools = new Tools({
  apiKey: process.env.UNIFAI_AGENT_API_KEY!,
});

export const txnApi = new TransactionAPI({
  apiKey: process.env.UNIFAI_AGENT_API_KEY!,
});

const provider = new JsonRpcProvider(process.env.POLYGON_RPC!);

export const wallet = new Wallet(process.env.POLYGON_PRIVATE_KEY!, provider);

export const LIVE = process.env.ARM_TRADE === "true";
