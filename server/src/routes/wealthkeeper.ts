import { Router } from "express";
import { requireGatewayAuth } from "../middleware/auth.js";
import { routeAIChat } from "../services/aiRouterService.js";
import { GatewayError } from "../types/ai.js";

export const wealthkeeperRouter = Router();

wealthkeeperRouter.post("/chat", requireGatewayAuth, async (req, res) => {
  try {
    const body = { ...req.body };
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
