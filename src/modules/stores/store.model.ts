import type { BaseRecord } from "../../storage/json-collection.js";

export interface Store extends BaseRecord {
  name: string;
  /** The owner account ID (ADMIN_ID). Set by the backend from the authenticated user, never from input. */
  ownerId: string;
  description: string | null;
}
