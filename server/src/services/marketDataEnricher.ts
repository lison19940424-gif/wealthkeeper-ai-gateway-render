import YahooFinance from "yahoo-finance2";
import type { FinancialContextSnapshot, HoldingDetail } from "../types/context.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

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

// Convert iOS/TwelveData symbol format to Yahoo Finance format
function normalizeForYahoo(symbol: string): string | null {
  if (!symbol || symbol.trim() === "") return null;
  const s = symbol.trim().toUpperCase();

  // Skip non-standard symbols (metals, FX pairs, etc.)
  if (s.includes("/") || s.includes("=") || s.includes("^")) return null;

  // A-share Shanghai: 600519.SH → 600519.SS
  if (s.endsWith(".SH")) return s.slice(0, -3) + ".SS";

  // A-share Shenzhen: 000001.SZ → 000001.SZ (unchanged)
  if (s.endsWith(".SZ")) return s;

  // HK stocks: strip extra leading zero from 5-digit numeric prefix
  // 00700.HK → 0700.HK, but 09988.HK stays as 09988.HK (valid 5-digit HK code)
  if (s.endsWith(".HK")) {
    const code = s.slice(0, -3);
    if (/^\d+$/.test(code) && code.length === 5 && code.startsWith("0")) {
      return code.slice(1) + ".HK";
    }
    return s;
  }

  // US stocks and others: no change
  return s;
}

function extractSymbols(snapshot: Partial<FinancialContextSnapshot>): string[] {
  const holdings: HoldingDetail[] = [
    ...(snapshot.stockHoldings ?? []),
    ...(snapshot.fundHoldings ?? []),
  ];
  const raw = holdings.map((h) => h.symbol).filter((s): s is string => !!s);
  const normalized = raw
    .map(normalizeForYahoo)
    .filter((s): s is string => s !== null);
  return [...new Set(normalized)].slice(0, 30);
}

async function fetchOneSymbol(symbol: string): Promise<[string, MarketDataPoint]> {
  const fetchedAt = new Date().toISOString();
  const empty: MarketDataPoint = {
    price: null, changePercent: null, high52w: null, low52w: null,
    marketCap: null, pe: null, dividendYield: null, last5Closes: [],
    currency: null, fetchedAt,
  };

  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 10);

    const quote = await yf.quote(symbol);
    const history: Array<{ close?: number }> = await yf
      .historical(symbol, { period1, period2: new Date(), interval: "1d" })
      .catch(() => []);

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

export async function enrichMarketData(
  snapshot: Partial<FinancialContextSnapshot>
): Promise<MarketDataMap> {
  const symbols = extractSymbols(snapshot);
  if (symbols.length === 0) return {};

  const TIMEOUT_MS = 15_000;
  type SettledList = PromiseSettledResult<[string, MarketDataPoint]>[];
  const results = await Promise.race<SettledList>([
    Promise.allSettled(symbols.map((sym) => fetchOneSymbol(sym))),
    new Promise<SettledList>((_, reject) =>
      setTimeout(() => reject(new Error("enrichMarketData global timeout")), TIMEOUT_MS)
    ),
  ]).catch((): SettledList => []);

  const map: MarketDataMap = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      const [sym, data] = r.value;
      if (data.price !== null || data.last5Closes.length > 0) {
        map[sym] = data;
      }
    }
  }
  return map;
}

export function formatMarketDataForPrompt(marketData: MarketDataMap): string {
  const entries = Object.entries(marketData);
  if (entries.length === 0) return "";

  const timestamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const lines = entries.map(([sym, d]) => {
    const price = d.price != null ? d.price.toLocaleString() : "N/A";
    const change = d.changePercent != null ? `${d.changePercent > 0 ? "+" : ""}${d.changePercent}%` : "N/A";
    const range52w = d.high52w != null && d.low52w != null
      ? `52w: ${d.low52w.toLocaleString()}-${d.high52w.toLocaleString()}`
      : "";
    const mcap = d.marketCap != null
      ? "市值 " + (d.marketCap >= 1e12
          ? (d.marketCap / 1e12).toFixed(1) + "T"
          : d.marketCap >= 1e9
          ? (d.marketCap / 1e9).toFixed(0) + "B"
          : (d.marketCap / 1e6).toFixed(0) + "M")
      : "";
    const pe = d.pe != null ? `P/E ${d.pe}` : "";
    const div = d.dividendYield != null && d.dividendYield > 0 ? `股息率 ${d.dividendYield}%` : "";
    const closes = d.last5Closes.length > 0 ? `近5日收盘: ${d.last5Closes.join(", ")}` : "";
    const parts = [range52w, mcap, pe, div, closes].filter(Boolean).join(" | ");
    return `- ${sym}: ${price} (${change})${parts ? " | " + parts : ""}`;
  });

  return `【最新行情数据（Yahoo Finance，截至 ${timestamp}）】\n${lines.join("\n")}`;
}
