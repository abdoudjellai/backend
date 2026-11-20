import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getStore } from "../../shared/utils/request-context.js";
import { idParams } from "../../shared/validation/common.js";
import { createCustomer, deleteCustomer, getCustomer, listCustomers, updateCustomer } from "./customers.service.js";
import { createCustomerSchema, listCustomersQuerySchema, updateCustomerSchema } from "./customers.validation.js";

const params = idParams("customerId");

export const postCustomer: RequestHandler = async (req, res) => {
  const input = createCustomerSchema.parse(req.body);
  sendSuccess(req, res, await createCustomer(getStore(req).id, input), 201);
};

export const getCustomers: RequestHandler = (req, res) => {
  const query = listCustomersQuerySchema.parse(req.query);
  sendSuccess(req, res, listCustomers(getStore(req).id, query));
};

export const getCustomerById: RequestHandler = (req, res) => {
  const { customerId } = params.parse(req.params);
  sendSuccess(req, res, getCustomer(getStore(req).id, customerId));
};

export const patchCustomer: RequestHandler = async (req, res) => {
  const { customerId } = params.parse(req.params);
  const input = updateCustomerSchema.parse(req.body);
  sendSuccess(req, res, await updateCustomer(getStore(req).id, customerId, input));
};

export const removeCustomer: RequestHandler = async (req, res) => {
  const { customerId } = params.parse(req.params);
  await deleteCustomer(getStore(req).id, customerId);
  sendSuccess(req, res, { id: customerId, deleted: true });
};
