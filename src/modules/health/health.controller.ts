import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getHealthReport } from "./health.service.js";

/**
 * 200 when the service and its storage files are usable; 503 otherwise, so load balancers and
 * uptime monitors stop routing traffic while data cannot be read or written.
 */
export const getHealth: RequestHandler = async (req, res) => {
  const report = await getHealthReport();
  if (report.status !== "ok") {
    throw AppError.serviceUnavailable("Service unavailable", report);
  }
  sendSuccess(req, res, report);
};
