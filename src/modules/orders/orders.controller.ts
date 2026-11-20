import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getStore } from "../../shared/utils/request-context.js";
import { idParams } from "../../shared/validation/common.js";
import { createOrder, getOrder, listOrders, updateOrder, updateOrderStatus } from "./orders.service.js";
import {
  createOrderSchema,
  listOrdersQuerySchema,
  updateOrderSchema,
  updateOrderStatusSchema,
} from "./orders.validation.js";

const params = idParams("orderId");

export const postOrder: RequestHandler = async (req, res) => {
  const input = createOrderSchema.parse(req.body);
  sendSuccess(req, res, await createOrder(getStore(req).id, input), 201);
};

export const getOrders: RequestHandler = (req, res) => {
  const query = listOrdersQuerySchema.parse(req.query);
  sendSuccess(req, res, listOrders(getStore(req).id, query));
};

export const getOrderById: RequestHandler = (req, res) => {
  const { orderId } = params.parse(req.params);
  sendSuccess(req, res, getOrder(getStore(req).id, orderId));
};

export const patchOrder: RequestHandler = async (req, res) => {
  const { orderId } = params.parse(req.params);
  const input = updateOrderSchema.parse(req.body);
  sendSuccess(req, res, await updateOrder(getStore(req).id, orderId, input));
};

export const patchOrderStatus: RequestHandler = async (req, res) => {
  const { orderId } = params.parse(req.params);
  const input = updateOrderStatusSchema.parse(req.body);
  sendSuccess(req, res, await updateOrderStatus(getStore(req).id, orderId, input));
};
