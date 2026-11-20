import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../../middleware/authenticate.js";
import { ErrorCodes } from "../../shared/constants/error-codes.js";
import type { ApiFailure } from "../../shared/types/api.js";
import { getMe, postLogin } from "./auth.controller.js";

export const LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 10 } as const;

/** Built per app instance so each app (and each test) gets its own rate-limit counters. */
export function createAuthRouter(): Router {
  const router = Router();

  // Slow down password guessing: 10 attempts per 15 minutes per client IP.
  const loginLimiter = rateLimit({
    ...LOGIN_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => {
      const body: ApiFailure = {
        success: false,
        error: { code: ErrorCodes.RATE_LIMITED, message: "Too many login attempts. Try again later." },
        requestId: req.requestId,
      };
      res.status(429).json(body);
    },
  });

  router.post("/login", loginLimiter, postLogin);
  router.get("/me", authenticate, getMe);
  return router;
}
