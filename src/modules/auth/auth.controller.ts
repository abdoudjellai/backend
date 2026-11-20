import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getAuth } from "../../shared/utils/request-context.js";
import { getOwnerProfile, login } from "./auth.service.js";
import { loginSchema } from "./auth.validation.js";

export const postLogin: RequestHandler = async (req, res) => {
  const input = loginSchema.parse(req.body);
  sendSuccess(req, res, await login(input));
};

export const getMe: RequestHandler = (req, res) => {
  getAuth(req);
  sendSuccess(req, res, getOwnerProfile());
};
