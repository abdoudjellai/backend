import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

// Accept a caller-supplied ID (e.g. from n8n or a gateway) only if it is short and plain,
// so it cannot be used to inject content into logs or response headers.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};
