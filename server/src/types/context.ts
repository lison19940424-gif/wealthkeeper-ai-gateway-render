export interface HoldingDetail {
  symbol?: string;
  name?: string;
  type?: string;
  quantity?: number;
  costBasis?: number;
  currentPrice?: number;
  marketValue?: number;
  dailyPnl?: number;
  totalPnl?: number;
  currencyCode?: string;
  extra?: string;
}

export interface FinancialContextSnapshot {
  stockHoldings?: HoldingDetail[];
  fundHoldings?: HoldingDetail[];
  optionHoldings?: HoldingDetail[];
  cryptoHoldings?: HoldingDetail[];
  [key: string]: unknown;
}
