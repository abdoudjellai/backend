import { Router } from "express";
import { getProductById, getProducts, patchProduct, postProduct, removeProduct } from "./products.controller.js";

/** Mounted at /api/v1/stores/:storeId/products after authentication and store-ownership checks. */
export const productsRouter = Router();

productsRouter.post("/", postProduct);
productsRouter.get("/", getProducts);
productsRouter.get("/:productId", getProductById);
productsRouter.patch("/:productId", patchProduct);
productsRouter.delete("/:productId", removeProduct);
