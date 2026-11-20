import { Router } from "express";

/**
 * Versioned API router, mounted at /api/v1.
 * Module routers (auth, stores, internal n8n tools, ...) are registered here from Milestone 2.
 */
export const apiRouter = Router();
