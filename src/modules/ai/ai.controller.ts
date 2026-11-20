import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { isAiConfigured, testAiConnection } from "./ai.service.js";

/** GET /api/v1/ai/status — check whether AI is configured and reachable. */
export const getAiStatus: RequestHandler = async (req, res) => {
  const configured = isAiConfigured();
  if (!configured) {
    sendSuccess(req, res, {
      configured: false,
      message: "AI provider is not configured. Set AI_BASE_URL and AI_API_KEY in your environment.",
    });
    return;
  }
  const result = await testAiConnection();
  sendSuccess(req, res, {
    configured: true,
    provider: result.provider,
    model: result.model,
    connected: result.ok,
    message: result.message,
    latencyMs: result.latencyMs,
  });
};
