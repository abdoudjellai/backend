import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getAuth, getStore } from "../../shared/utils/request-context.js";
import { createStore, deleteStore, listStores, updateStore } from "./stores.service.js";
import { createStoreSchema, listStoresQuerySchema, updateStoreSchema } from "./stores.validation.js";

export const postStore: RequestHandler = async (req, res) => {
  const input = createStoreSchema.parse(req.body);
  sendSuccess(req, res, await createStore(getAuth(req).ownerId, input), 201);
};

export const getStores: RequestHandler = (req, res) => {
  const { page, limit } = listStoresQuerySchema.parse(req.query);
  sendSuccess(req, res, listStores(getAuth(req).ownerId, page, limit));
};

export const getStoreById: RequestHandler = (req, res) => {
  sendSuccess(req, res, getStore(req));
};

export const patchStore: RequestHandler = async (req, res) => {
  const input = updateStoreSchema.parse(req.body);
  sendSuccess(req, res, await updateStore(getStore(req), input));
};

export const removeStore: RequestHandler = async (req, res) => {
  const store = getStore(req);
  await deleteStore(store);
  sendSuccess(req, res, { id: store.id, deleted: true });
};
