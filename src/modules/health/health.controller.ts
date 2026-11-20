import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getHealthReport } from "./health.service.js";

/**
 * 200 when the service and its database are usable; 503 otherwise, so load balancers and
 * uptime monitors stop routing traffic while MongoDB is unreachable.
 */
export const getHealth: RequestHandler = (req, res) => {
  const report = getHealthReport();
  if (report.status !== "ok") {
    throw AppError.serviceUnavailable("Service unavailable", report);
  }
  sendSuccess(req, res, report);
};
