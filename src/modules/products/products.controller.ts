import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/utils/http-response.js";
import { getStore } from "../../shared/utils/request-context.js";
import { idParams } from "../../shared/validation/common.js";
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "./products.service.js";
import { createProductSchema, listProductsQuerySchema, updateProductSchema } from "./products.validation.js";

const params = idParams("productId");

export const postProduct: RequestHandler = async (req, res) => {
  const input = createProductSchema.parse(req.body);
  sendSuccess(req, res, await createProduct(getStore(req).id, input), 201);
};

export const getProducts: RequestHandler = (req, res) => {
  const query = listProductsQuerySchema.parse(req.query);
  sendSuccess(req, res, listProducts(getStore(req).id, query));
};

export const getProductById: RequestHandler = (req, res) => {
  const { productId } = params.parse(req.params);
  sendSuccess(req, res, getProduct(getStore(req).id, productId));
};

export const patchProduct: RequestHandler = async (req, res) => {
  const { productId } = params.parse(req.params);
  const input = updateProductSchema.parse(req.body);
  sendSuccess(req, res, await updateProduct(getStore(req).id, productId, input));
};

export const removeProduct: RequestHandler = async (req, res) => {
  const { productId } = params.parse(req.params);
  await deleteProduct(getStore(req).id, productId);
  sendSuccess(req, res, { id: productId, deleted: true });
};
