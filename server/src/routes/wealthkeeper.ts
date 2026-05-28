import { Router } from "express";
import { requireGatewayAuth } from "../middleware/auth.js";
import { routeAIChat } from "../services/aiRouterService.js";
import { enrichMarketData } from "../services/marketDataEnricher.js";
import { GatewayError } from "../types/ai.js";

export const wealthkeeperRouter = Router();

wealthkeeperRouter.post("/chat", requireGatewayAuth, async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.context && typeof body.context === "object") {
      const ctx = body.context as Record<string, unknown>;
      console.log("[chat] stockHoldings count:", (ctx.stockHoldings as unknown[])?.length ?? 0);
      console.log("[chat] cryptoHoldings count:", (ctx.cryptoHoldings as unknown[])?.length ?? 0);
      console.log("[chat] fundHoldings count:", (ctx.fundHoldings as unknown[])?.length ?? 0);
      const marketData = await enrichMarketData(body.context).catch(() => ({}));
      console.log("[chat] enriched marketData:", JSON.stringify(marketData).slice(0, 2000));
      body.context = { ...body.context, marketData };
    }
    const response = await routeAIChat(body);
    return res.json(response);
  } catch (error) {
    if (error instanceof GatewayError) {
      return res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    return res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        message: "AI Gateway 服务异常。"
      }
    });
  }
});
