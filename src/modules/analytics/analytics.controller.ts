import type { RequestHandler } from "express";
import { z } from "zod";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getStore } from "../../shared/utils/request-context.js";
import { dateQuery } from "../../shared/validation/common.js";
import { getAiStats, getOrderStats, getOverview } from "./analytics.service.js";

const rangeQuerySchema = z
  .object({
    from: dateQuery("start").optional(),
    to: dateQuery("end").optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: "from must be before to",
    path: ["from"],
  });

export const getAnalyticsOverview: RequestHandler = (req, res) => {
  sendSuccess(req, res, getOverview(getStore(req).id));
};

export const getAnalyticsOrders: RequestHandler = (req, res) => {
  const range = rangeQuerySchema.parse(req.query);
  sendSuccess(req, res, getOrderStats(getStore(req).id, range));
};

export const getAnalyticsAi: RequestHandler = (req, res) => {
  sendSuccess(req, res, getAiStats(getStore(req).id));
};
