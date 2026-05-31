import { GatewayError, type AIChatMessage, type AIChatRequest, type AIChatResponse } from "../types/ai.js";
import { buildSimpleMarketData } from "./simpleMarketDataService.js";
import { buildMessages } from "./promptBuilder.js";
import { normalizeAIResponse } from "./responseNormalizer.js";

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
    code?: string;
  };
}

export async function callDeepSeek(request: AIChatRequest, model: string): Promise<AIChatResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new GatewayError("MISSING_API_KEY", "未配置 DeepSeek API Key，请检查服务端环境变量。", 500);
  }

  const baseURL = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const url = `${baseURL}/chat/completions`;
  const enrichedRequest = await enrichRequestWithMarketData(request);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(enrichedRequest, "deepseek") as AIChatMessage[],
        temperature: 0.2,
        stream: false
      })
    });
  } catch {
    throw new GatewayError("MODEL_ERROR", "DeepSeek 服务连接失败，请稍后重试。", 502);
  }

  const rawText = await response.text();
  let payload: DeepSeekChatResponse | null = null;
  try {
    payload = rawText ? (JSON.parse(rawText) as DeepSeekChatResponse) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const upstreamMessage = payload?.error?.message;
    throw new GatewayError("MODEL_ERROR", upstreamMessage ? `DeepSeek 调用失败：${upstreamMessage}` : "DeepSeek 调用失败，请检查模型名称或服务状态。", 502);
  }

  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new GatewayError("MODEL_ERROR", "DeepSeek 没有返回可展示的内容。", 502);
  }

  return normalizeAIResponse(content);
}

async function enrichRequestWithMarketData(request: AIChatRequest): Promise<AIChatRequest> {
  const context = request.context ?? {};
  const marketData = await buildSimpleMarketData(context).catch(() => ({}));
  if (Object.keys(marketData).length === 0) return request;
  return {
    ...request,
    context: {
      ...context,
      marketData
    }
  };
}
