import type { Request, Response } from "express";
import type { ApiSuccess } from "../types/api.js";

/** Send data in the standard success envelope. */
export function sendSuccess<T>(req: Request, res: Response, data: T, statusCode = 200): void {
  const body: ApiSuccess<T> = { success: true, data, requestId: req.requestId };
  res.status(statusCode).json(body);
}
