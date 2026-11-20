import type { RequestHandler } from "express";
import { verifyAccessToken } from "../modules/auth/auth.service.js";
import { AppError } from "../shared/errors/app-error.js";

/** Require a valid `Authorization: Bearer <token>` header and attach the owner to `req.auth`. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get("authorization");
  const match = header === undefined ? null : /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if (match?.[1] === undefined) {
    throw AppError.unauthorized("Missing or malformed Authorization header (expected: Bearer <token>)");
  }
  req.auth = await verifyAccessToken(match[1]);
  next();
};
