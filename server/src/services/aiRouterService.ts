import { GatewayError, type AIChatRequest, type AIChatResponse, type AIProvider } from "../types/ai.js";
import { callDeepSeek } from "./deepseekService.js";

export async function routeAIChat(request: AIChatRequest): Promise<AIChatResponse> {
  if (!request.question?.trim()) {
    throw new GatewayError("BAD_REQUEST", "问题不能为空。", 400);
  }

  const provider = resolveProvider(request.options?.provider);
  const model = resolveModel(provider, request.options?.model);

  switch (provider) {
    case "deepseek":
      return callDeepSeek(request, model);
    default:
      throw new GatewayError("BAD_REQUEST", "不支持的模型服务商。", 400);
  }
}

function resolveProvider(value?: string): AIProvider {
  const provider = (value || process.env.DEFAULT_PROVIDER || "deepseek") as AIProvider;
  if (provider === "deepseek") {
    return provider;
  }
  throw new GatewayError("BAD_REQUEST", "不支持的模型服务商。", 400);
}

function resolveModel(provider: AIProvider, requested?: string): string {
  if (requested?.trim()) return requested.trim();
  if (provider === "deepseek") return process.env.DEEPSEEK_DEFAULT_MODEL || process.env.DEFAULT_MODEL || "deepseek-chat";
  return process.env.DEFAULT_MODEL || "deepseek-chat";
}
