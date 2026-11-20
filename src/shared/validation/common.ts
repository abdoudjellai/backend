import { z } from "zod";
import { normalizeAlgerianPhone } from "../utils/phone.js";

/** Record IDs: generated as `<prefix>_<hex>`; short hand-written IDs like `store_001` are also valid. */
export const idSchema = z.string().regex(/^[a-z]+_[A-Za-z0-9]{1,64}$/, "invalid id");

export const idParams = <K extends string>(...keys: K[]) =>
  z.object(Object.fromEntries(keys.map((key) => [key, idSchema])) as Record<K, typeof idSchema>);

/** Algerian phone number, normalized to national format (e.g. "0550123456"). */
export const phoneSchema = z
  .string()
  .max(30)
  .transform((value, ctx) => {
    const normalized = normalizeAlgerianPhone(value);
    if (normalized === null) {
      ctx.addIssue({ code: "custom", message: "must be a valid Algerian phone number, e.g. 0550123456 or +213550123456" });
      return z.NEVER;
    }
    return normalized;
  });

/** Trimmed text; empty strings become null so "cleared" fields are stored consistently. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/** Channels a customer or order can come from. */
export const CHANNEL_SOURCES = ["manual", "messenger", "whatsapp", "instagram", "website", "phone", "telegram"] as const;
export type ChannelSource = (typeof CHANNEL_SOURCES)[number];
export const channelSourceSchema = z.enum(CHANNEL_SOURCES);

export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

/**
 * Date filter value: a date ("2026-11-20", interpreted in UTC) or a full ISO-8601 datetime.
 * `edge: "end"` makes a date-only value inclusive of that whole day.
 */
export const dateQuery = (edge: "start" | "end") =>
  z.union([z.iso.date(), z.iso.datetime({ offset: true })]).transform((value) => {
    if (value.length === 10) {
      const day = new Date(`${value}T00:00:00.000Z`);
      return edge === "start" ? day : new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1);
    }
    return new Date(value);
  });
