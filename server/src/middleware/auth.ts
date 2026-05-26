import type { NextFunction, Request, Response } from "express";

export function requireGatewayAuth(req: Request, res: Response, next: NextFunction) {
  const expectedToken = process.env.WEALTHKEEPER_GATEWAY_TOKEN;
  const authorization = req.header("authorization") ?? "";

  if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "未授权，请检查 Gateway Token。"
      }
    });
  }

  next();
}
