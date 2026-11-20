import { env } from "../config/env.js";
import { Storage } from "./storage.js";

/** The application's storage instance. Opened in server.ts before the server accepts traffic. */
export const storage = new Storage(env.DATA_DIR);
