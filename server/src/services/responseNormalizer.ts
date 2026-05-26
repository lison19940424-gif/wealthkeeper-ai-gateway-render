import type { AIChatResponse, AIInsight, InsightLevel, RiskLevel } from "../types/ai.js";

export function normalizeAIResponse(raw: string): AIChatResponse {
  const text = raw.trim();
  if (!text) {
    return {
      answer: "模型没有返回可展示的内容。",
      insights: [],
      riskLevel: "medium",
      suggestedQuestions: []
    };
  }

  const jsonText = extractJson(text);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Partial<AIChatResponse>;
      if (typeof parsed.answer === "string" && parsed.answer.trim()) {
        return {
          answer: parsed.answer,
          insights: normalizeInsights(parsed.insights),
          riskLevel: normalizeRiskLevel(parsed.riskLevel),
          suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions.filter((item) => typeof item === "string") : []
        };
      }
    } catch {
      // fall through to text fallback
    }
  }

  return {
    answer: text,
    insights: [],
    riskLevel: "medium",
    suggestedQuestions: []
  };
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function normalizeInsights(value: unknown): AIInsight[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Partial<AIInsight>;
      if (typeof raw.title !== "string" || typeof raw.content !== "string") return null;
      return {
        title: raw.title,
        content: raw.content,
        level: normalizeInsightLevel(raw.level)
      };
    })
    .filter((item): item is AIInsight => item !== null);
}

function normalizeInsightLevel(value: unknown): InsightLevel {
  return value === "info" || value === "warning" || value === "risk" ? value : "info";
}

function extractJson(text: string): string | null {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) return cleaned;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return cleaned.slice(start, end + 1);
  return null;
}
