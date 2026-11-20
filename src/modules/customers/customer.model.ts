import type { BaseRecord } from "../../storage/json-collection.js";
import type { ChannelSource } from "../../shared/validation/common.js";

export interface Customer extends BaseRecord {
  storeId: string;
  name: string | null;
  /** Normalized Algerian national format, e.g. "0550123456". Unique per store when present. */
  phone: string | null;
  wilaya: string | null;
  address: string | null;
  source: ChannelSource;
  /**
   * The customer's ID on `source` (e.g. a Messenger PSID). Unique per store + source when present.
   * Not a phone number.
   */
  platformCustomerId: string | null;
}
