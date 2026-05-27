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
  const provider = (value || process.env.DEFAULT_PROVIDER || "deepseek").trim();
  if (provider === "deepseek") {
    return "deepseek";
  }

  // Compatibility for older iOS builds that still label DeepSeek as OpenAI-compatible.
  // The cloud Gateway currently routes all real-model requests to DeepSeek only.
  if (provider === "openai" || provider === "local_qwen" || provider === "anthropic") {
    return "deepseek";
  }

  throw new GatewayError("BAD_REQUEST", "不支持的模型服务商。", 400);
}

function resolveModel(provider: AIProvider, requested?: string): string {
  const requestedModel = requested?.trim();
  if (requestedModel && requestedModel !== "deepseek-v4-pro" && requestedModel !== "qwen-local" && requestedModel !== "claude-sonnet-4-6") {
    return requestedModel;
  }
  if (provider === "deepseek") return process.env.DEEPSEEK_DEFAULT_MODEL || process.env.DEFAULT_MODEL || "deepseek-chat";
  return process.env.DEFAULT_MODEL || "deepseek-chat";
}
