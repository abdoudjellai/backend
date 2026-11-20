import { Router } from "express";
import { getAiStatus } from "./ai.controller.js";

/** Mounted at /api/v1/ai — authenticated. */
export function createAiRouter(): Router {
  const router = Router();
  router.get("/status", getAiStatus);
  return router;
}
