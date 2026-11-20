import { Router } from "express";
import { getCustomerById, getCustomers, patchCustomer, postCustomer, removeCustomer } from "./customers.controller.js";

/** Mounted at /api/v1/stores/:storeId/customers after authentication and store-ownership checks. */
export const customersRouter = Router();

customersRouter.post("/", postCustomer);
customersRouter.get("/", getCustomers);
customersRouter.get("/:customerId", getCustomerById);
customersRouter.patch("/:customerId", patchCustomer);
customersRouter.delete("/:customerId", removeCustomer);
