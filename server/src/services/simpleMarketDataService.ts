interface HoldingDetail {
  symbol?: string;
  type?: string;
  marketValue?: number;
}

type SnapshotLike = {
  stockHoldings?: HoldingDetail[];
  fundHoldings?: HoldingDetail[];
  optionHoldings?: HoldingDetail[];
  cryptoHoldings?: HoldingDetail[];
};

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

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
      };
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }>;
  };
}

export async function buildSimpleMarketData(snapshot: SnapshotLike): Promise<MarketDataMap> {
  const symbols = extractSymbols(snapshot).slice(0, 20);
  const pairs = await Promise.all(symbols.map(async (symbol) => [symbol, await fetchOne(symbol)] as const));
  const map: MarketDataMap = {};
  for (const [symbol, data] of pairs) {
    if (data.price !== null || data.last5Closes.length > 0) {
      map[symbol] = data;
    }
  }
  return map;
}

function extractSymbols(snapshot: SnapshotLike): string[] {
  const holdings: HoldingDetail[] = [
    ...(snapshot.stockHoldings ?? []),
    ...(snapshot.fundHoldings ?? []),
    ...(snapshot.optionHoldings ?? []),
    ...(snapshot.cryptoHoldings ?? [])
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const holding of holdings) {
    const symbol = normalizeSymbol(holding.symbol ?? "", holding.type ?? "");
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    result.push(symbol);
  }
  return result;
}

async function fetchOne(symbol: string): Promise<MarketDataPoint> {
  const yahoo = await fetchYahoo(symbol).catch(() => null);
  if (yahoo && (yahoo.price !== null || yahoo.last5Closes.length > 0)) return yahoo;
  const stooq = await fetchStooq(symbol).catch(() => null);
  return stooq ?? emptyPoint();
}

async function fetchYahoo(symbol: string): Promise<MarketDataPoint | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=7d&interval=1d`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 WealthKeeper/1.0" },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as YahooChartResponse;
  const result = payload.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return null;

  const closes = result?.indicators?.quote?.[0]?.close?.filter((value): value is number => typeof value === "number") ?? [];
  const price = meta.regularMarketPrice ?? closes.at(-1) ?? null;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? closes.at(-2) ?? null;
  return {
    ...emptyPoint(),
    price,
    changePercent: price !== null && previousClose ? round(((price - previousClose) / previousClose) * 100, 2) : null,
    last5Closes: closes.slice(-5).map((value) => round(value, 2)),
    currency: meta.currency ?? null,
    fetchedAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString()
  };
}

async function fetchStooq(symbol: string): Promise<MarketDataPoint | null> {
  const stooqSymbol = toStooqSymbol(symbol);
  if (!stooqSymbol) return null;
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 WealthKeeper/1.0" },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) return null;
  const text = await response.text();
  const rows = text.trim().split(/\r?\n/);
  if (rows.length < 2) return null;
  const values = rows[1].split(",");
  const close = Number(values[6]);
  if (!Number.isFinite(close)) return null;
  return {
    ...emptyPoint(),
    price: close,
    last5Closes: [close],
    currency: "USD",
    fetchedAt: new Date().toISOString()
  };
}

function normalizeSymbol(raw: string, type: string): string | null {
  const symbol = raw.trim().toUpperCase();
  if (!symbol) return null;
  if (type === "期权") {
    const match = symbol.match(/^([A-Z][A-Z0-9]{0,5})\d{6}[CP]/);
    if (match) return match[1];
  }
  if (type === "数字资产" && !symbol.includes("-") && !symbol.includes(".")) return `${symbol}-USD`;
  if (symbol.endsWith(".SH")) return `${symbol.slice(0, -3)}.SS`;
  if (symbol.endsWith(".HK")) return symbol;
  return symbol.replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
}

function toStooqSymbol(symbol: string): string | null {
  if (/^[A-Z]{1,6}$/.test(symbol)) return `${symbol.toLowerCase()}.us`;
  return null;
}

function emptyPoint(): MarketDataPoint {
  return {
    price: null,
    changePercent: null,
    high52w: null,
    low52w: null,
    marketCap: null,
    pe: null,
    dividendYield: null,
    last5Closes: [],
    currency: null,
    fetchedAt: new Date().toISOString()
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
