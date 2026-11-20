/**
 * Normalize an Algerian phone number to its national format (leading 0).
 *
 * Accepts separators (spaces, dots, dashes, parentheses) and the +213 / 00213 / 213 prefixes:
 *   "+213 550 12 34 56" → "0550123456"
 *   "0550-12-34-56"     → "0550123456"
 *   "021 23 45 67"      → "021234567"
 *
 * Returns null when the input is not a plausible Algerian mobile (05/06/07 + 8 digits)
 * or landline (0 + 8 digits) number.
 */
export function normalizeAlgerianPhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s.\-()]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;

  let digits = compact.replace(/^\+/, "");
  if (digits.startsWith("00213")) digits = `0${digits.slice(5)}`;
  else if (digits.startsWith("213") && digits.length >= 11) digits = `0${digits.slice(3)}`;

  const isMobile = /^0[5-7]\d{8}$/.test(digits);
  const isLandline = /^0[1-9]\d{7}$/.test(digits);
  return isMobile || isLandline ? digits : null;
}
