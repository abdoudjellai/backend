import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getStore } from "../../shared/utils/request-context.js";
import { idParams } from "../../shared/validation/common.js";
import { createAiAnalysis, getOrderAnalyses, listAiAnalyses } from "./ai-analytics.service.js";
import { createAiAnalysisSchema, listAiAnalysesQuerySchema } from "./ai-analytics.validation.js";

const orderParams = idParams("orderId");

export const postAiAnalysis: RequestHandler = async (req, res) => {
  const input = createAiAnalysisSchema.parse(req.body);
  sendSuccess(req, res, await createAiAnalysis(getStore(req).id, input), 201);
};

export const getAiAnalyses: RequestHandler = (req, res) => {
  const query = listAiAnalysesQuerySchema.parse(req.query);
  sendSuccess(req, res, listAiAnalyses(getStore(req).id, query));
};

export const getAiAnalysesForOrder: RequestHandler = (req, res) => {
  const { orderId } = orderParams.parse(req.params);
  sendSuccess(req, res, getOrderAnalyses(getStore(req).id, orderId));
};
