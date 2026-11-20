import type { BaseRecord } from "../../storage/json-collection.js";
import type { ChannelSource } from "../../shared/validation/common.js";
import type { ProductSize } from "../products/product.model.js";
import type { OrderStatus } from "./order-status.js";

/** A line item. Name and price are snapshots taken from the catalog when the line was priced. */
export interface OrderItem {
  productId: string;
  productName: string;
  size: ProductSize | null;
  color: string | null;
  quantity: number;
  /** Catalog price in DZD at pricing time — never a client-supplied value. */
  unitPrice: number;
  lineTotal: number;
}

export interface OrderDelivery {
  wilaya: string | null;
  address: string | null;
  phone: string | null;
  /** Courier company. Set manually by the owner; never assigned automatically. */
  company: string | null;
  trackingNumber: string | null;
}

export interface OrderStatusChange {
  status: OrderStatus;
  at: string;
  note: string | null;
}

export interface Order extends BaseRecord {
  storeId: string;
  customerId: string;
  items: OrderItem[];
  /** Sum of line totals in DZD, calculated by the backend. */
  totalAmount: number;
  currency: "DZD";
  delivery: OrderDelivery;
  status: OrderStatus;
  source: ChannelSource;
  notes: string | null;
  /** Every status the order has been in, oldest first. */
  statusHistory: OrderStatusChange[];
}
