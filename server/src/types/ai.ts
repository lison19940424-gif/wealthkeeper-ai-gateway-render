export type AIProvider = "deepseek";
export type RiskLevel = "low" | "medium" | "high";
export type InsightLevel = "info" | "warning" | "risk";

export interface AIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIChatRequest {
  systemPrompt?: string;
  question?: string;
  context?: Record<string, unknown>;
  chatHistory?: AIChatMessage[];
  options?: {
    provider?: string;
    model?: string;
    language?: string;
    answerStyle?: "concise" | "detailed";
    riskMode?: "careful";
  };
}

export interface AIInsight {
  title: string;
  content: string;
  level: InsightLevel;
}

export interface AIChatResponse {
  answer: string;
  insights: AIInsight[];
  riskLevel: RiskLevel;
  suggestedQuestions: string[];
}

export type GatewayErrorCode =
  | "UNAUTHORIZED"
  | "BAD_REQUEST"
  | "MISSING_API_KEY"
  | "MODEL_ERROR"
  | "SERVER_ERROR";

export class GatewayError extends Error {
  code: GatewayErrorCode;
  status: number;

  constructor(code: GatewayErrorCode, message: string, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
