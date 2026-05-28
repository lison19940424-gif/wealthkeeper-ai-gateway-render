import YahooFinance from "yahoo-finance2";
import type { FinancialContextSnapshot, HoldingDetail } from "../types/context.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const MAX_SYMBOLS = 60;
const MAX_PROMPT_SYMBOLS = 30;
const CONCURRENCY = 10;
const PER_SYMBOL_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 25_000;

export interface MarketDataPoint {
  price: number | null;
  changePercent: number | null;
  high52w: number | null;
  low52w: number | null;
  marketCap: number | null;
  pe: number | null;
  dividendYield: number | null;
  last5Closes: number[];
  currency: string | null;
  fetchedAt: string;
}

export type MarketDataMap = Record<string, MarketDataPoint>;

// ---------------------------------------------------------------------------
// Symbol normalisation
// ---------------------------------------------------------------------------

/** Convert iOS/TwelveData symbol to Yahoo Finance format. Returns null to skip. */
function normalizeForYahoo(symbol: string, type?: string): string | null {
  if (!symbol || symbol.trim() === "") return null;
  const s = symbol.trim().toUpperCase();

  // Options: extract underlying ticker from OCC-format contract symbol
  // e.g. AAPL250620C00150000 → AAPL, SPX250620P05000000 → SPX
  if (type === "期权") {
    const occMatch = s.match(/^([A-Z][A-Z0-9]{0,5})\d{6}[CP]/);
    if (occMatch) return occMatch[1];
    // Not OCC format – fall through and normalise as regular symbol
  }

  // Skip FX pairs, commodities, indices that Yahoo can't match cleanly
  if (s.includes("=") || s.startsWith("^")) return null;

  // Crypto: BTC/USD → BTC-USD; bare BTC → BTC-USD
  if (s.includes("/")) return s.replace("/", "-");
  if (type === "数字资产" && !s.includes("-") && !s.includes(".")) {
    return `${s}-USD`;
  }

  // Metals: no reliable Yahoo Finance mapping for Chinese gold/silver products; skip.
  // XAU/USD is spot Forex, not the physical gold most users hold via A-share Gold ETF.
  if (type === "贵金属") return null;

  // A-share Shanghai: 600519.SH → 600519.SS
  if (s.endsWith(".SH")) return s.slice(0, -3) + ".SS";

  // A-share Shenzhen: unchanged
  if (s.endsWith(".SZ")) return s;

  // HK stocks: strip extra leading zero from 5-digit numeric prefix
  // 00700.HK (5 digits) → 0700.HK; 09988.HK (valid 5-digit) stays as-is
  if (s.endsWith(".HK")) {
    const code = s.slice(0, -3);
    if (/^\d+$/.test(code) && code.length === 5 && code.startsWith("0")) {
      return code.slice(1) + ".HK";
    }
    return s;
  }

  // US stocks and everything else: no change
  return s;
}

// ---------------------------------------------------------------------------
// Symbol extraction from snapshot (all holding types, sorted by market value)
// ---------------------------------------------------------------------------

interface SymbolEntry {
  yahoo: string;
  marketValue: number;
}

function extractSymbols(snapshot: Partial<FinancialContextSnapshot>): string[] {
  const toTyped = (arr: HoldingDetail[] | undefined, fallbackType: string) =>
    (arr ?? []).map((h): HoldingDetail & { holdingType: string } => ({
      ...h, holdingType: h.type ?? fallbackType,
    }));

  const allHoldings = [
    ...toTyped(snapshot.stockHoldings, "股票"),
    ...toTyped(snapshot.fundHoldings, "基金/ETF"),
    ...toTyped(snapshot.optionHoldings, "期权"),
    ...toTyped(snapshot.cryptoHoldings, "数字资产"),
    // metalHoldings intentionally excluded: Chinese gold/silver products have no reliable Yahoo ticker
  ];

  const seen = new Map<string, number>(); // yahoo symbol → max marketValue
  for (const h of allHoldings) {
    const yahoo = normalizeForYahoo(h.symbol ?? "", h.holdingType);
    if (!yahoo) continue;
    const mv = typeof h.marketValue === "number" ? Math.abs(h.marketValue) : 0;
    const prev = seen.get(yahoo) ?? 0;
    if (mv > prev) seen.set(yahoo, mv);
  }

  // Sort by market value desc, take top MAX_SYMBOLS
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SYMBOLS)
    .map(([sym]) => sym);
}

// ---------------------------------------------------------------------------
// Per-symbol fetch with individual timeout
// ---------------------------------------------------------------------------

async function fetchOneSymbol(symbol: string): Promise<[string, MarketDataPoint]> {
  const fetchedAt = new Date().toISOString();
  const empty: MarketDataPoint = {
    price: null, changePercent: null, high52w: null, low52w: null,
    marketCap: null, pe: null, dividendYield: null, last5Closes: [],
    currency: null, fetchedAt,
  };

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);

  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 10);

    const [quote, history] = await withTimeout(
      Promise.all([
        yf.quote(symbol),
        yf.historical(symbol, { period1, period2: new Date(), interval: "1d" }).catch(() => []),
      ]),
      PER_SYMBOL_TIMEOUT_MS
    );

    const last5Closes = (history as Array<{ close?: number }>)
      .filter((d) => typeof d.close === "number")
      .slice(-5)
      .map((d) => Math.round((d.close as number) * 100) / 100);

    return [symbol, {
      price: typeof quote.regularMarketPrice === "number" ? quote.regularMarketPrice : null,
      changePercent: typeof quote.regularMarketChangePercent === "number"
        ? Math.round(quote.regularMarketChangePercent * 100) / 100
        : null,
      high52w: typeof quote.fiftyTwoWeekHigh === "number" ? quote.fiftyTwoWeekHigh : null,
      low52w: typeof quote.fiftyTwoWeekLow === "number" ? quote.fiftyTwoWeekLow : null,
      marketCap: typeof quote.marketCap === "number" ? quote.marketCap : null,
      pe: typeof quote.trailingPE === "number" ? Math.round(quote.trailingPE * 10) / 10 : null,
      dividendYield: typeof quote.trailingAnnualDividendYield === "number"
        ? Math.round(quote.trailingAnnualDividendYield * 10000) / 100
        : null,
      last5Closes,
      currency: typeof quote.currency === "string" ? quote.currency : null,
      fetchedAt,
    }];
  } catch {
    return [symbol, empty];
  }
}

// ---------------------------------------------------------------------------
// Concurrency-limited pool (no p-limit dependency)
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function enrichMarketData(
  snapshot: Partial<FinancialContextSnapshot>
): Promise<MarketDataMap> {
  const t0 = Date.now();
  const symbols = extractSymbols(snapshot);
  if (symbols.length === 0) return {};

  const tasks = symbols.map((sym) => () => fetchOneSymbol(sym));

  type PairList = [string, MarketDataPoint][];
  const pairs = await Promise.race<PairList>([
    runWithConcurrency(tasks, CONCURRENCY) as Promise<PairList>,
    new Promise<PairList>((_, reject) =>
      setTimeout(() => reject(new Error("enrichMarketData global timeout")), TOTAL_TIMEOUT_MS)
    ),
  ]).catch((): PairList => []);

  const map: MarketDataMap = {};
  let succeeded = 0;
  for (const [sym, data] of pairs) {
    if (data.price !== null || data.last5Closes.length > 0) {
      map[sym] = data;
      succeeded++;
    }
  }

  const took = Date.now() - t0;
  console.log(
    `[marketDataEnricher] requested=${symbols.length} succeeded=${succeeded} failed=${symbols.length - succeeded} took=${took}ms`
  );

  return map;
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

export function formatMarketDataForPrompt(marketData: MarketDataMap): string {
  const entries = Object.entries(marketData);
  if (entries.length === 0) return "";

  const timestamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const shown = entries.slice(0, MAX_PROMPT_SYMBOLS);
  const omitted = entries.length - shown.length;

  const lines = shown.map(([sym, d]) => {
    const price = d.price != null ? d.price.toLocaleString() : "N/A";
    const change = d.changePercent != null
      ? `${d.changePercent > 0 ? "+" : ""}${d.changePercent}%` : "N/A";
    const range52w = d.high52w != null && d.low52w != null
      ? `52w: ${d.low52w.toLocaleString()}-${d.high52w.toLocaleString()}` : "";
    const mcap = d.marketCap != null
      ? "市值 " + (d.marketCap >= 1e12
        ? (d.marketCap / 1e12).toFixed(1) + "T"
        : d.marketCap >= 1e9
        ? (d.marketCap / 1e9).toFixed(0) + "B"
        : (d.marketCap / 1e6).toFixed(0) + "M")
      : "";
    const pe = d.pe != null ? `P/E ${d.pe}` : "";
    const div = d.dividendYield != null && d.dividendYield > 0
      ? `股息率 ${d.dividendYield}%` : "";
    const closes = d.last5Closes.length > 0
      ? `近5日收盘: ${d.last5Closes.join(", ")}` : "";
    const parts = [range52w, mcap, pe, div, closes].filter(Boolean).join(" | ");
    return `- ${sym}: ${price} (${change})${parts ? " | " + parts : ""}`;
  });

  const footer = omitted > 0
    ? `（其余 ${omitted} 只行情数据已采集但因 prompt 长度限制省略，AI 可基于已展示的代表性标的分析）`
    : "";

  return [
    `【最新行情数据（Yahoo Finance，截至 ${timestamp}）】`,
    ...lines,
    ...(footer ? [footer] : []),
  ].join("\n");
}
