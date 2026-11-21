export interface CourierQuote {
  name: string;
  price: number | null;
  days: [number, number] | null;
  successRate: number | null;
}

const COURIER_DATA: Record<string, CourierQuote[]> = {
  Algiers: [
    { name: "Yalidine", price: 400, days: [1, 1], successRate: 94 },
    { name: "ZR Express", price: 380, days: [1, 2], successRate: 88 },
    { name: "Maystro", price: 350, days: [2, 3], successRate: 80 },
  ],
  Blida: [
    { name: "Yalidine", price: 500, days: [1, 2], successRate: 92 },
    { name: "ZR Express", price: 450, days: [2, 3], successRate: 85 },
    { name: "Maystro", price: 400, days: [2, 3], successRate: 78 },
  ],
  Oran: [
    { name: "Yalidine", price: 700, days: [2, 3], successRate: 90 },
    { name: "ZR Express", price: 650, days: [2, 4], successRate: 83 },
    { name: "Maystro", price: 600, days: [3, 4], successRate: 76 },
  ],
  Constantine: [
    { name: "Yalidine", price: 650, days: [2, 3], successRate: 89 },
    { name: "ZR Express", price: 600, days: [2, 3], successRate: 84 },
    { name: "Maystro", price: 550, days: [3, 5], successRate: 74 },
  ],
  Setif: [
    { name: "Yalidine", price: 650, days: [2, 3], successRate: 88 },
    { name: "ZR Express", price: 600, days: [2, 4], successRate: 82 },
    { name: "Maystro", price: 550, days: [3, 5], successRate: 73 },
  ],
  Annaba: [
    { name: "Yalidine", price: 700, days: [2, 4], successRate: 87 },
    { name: "ZR Express", price: 650, days: [3, 4], successRate: 81 },
    { name: "Maystro", price: 600, days: [3, 5], successRate: 72 },
  ],
  Tizi_Ouzou: [
    { name: "Yalidine", price: 550, days: [1, 2], successRate: 91 },
    { name: "ZR Express", price: 500, days: [2, 3], successRate: 86 },
    { name: "Maystro", price: 450, days: [2, 3], successRate: 79 },
  ],
};

const DEFAULT_QUOTES: CourierQuote[] = [
  { name: "Yalidine", price: 700, days: [2, 4], successRate: 85 },
  { name: "ZR Express", price: 650, days: [3, 5], successRate: 80 },
  { name: "Maystro", price: 600, days: [3, 5], successRate: 72 },
];

export function getCourierQuotes(wilaya: string | null): CourierQuote[] {
  if (!wilaya) return DEFAULT_QUOTES;
  const normalized = wilaya.trim().replace(/[\s-]+/g, "_");
  const key = Object.keys(COURIER_DATA).find(
    (k) => k.toLowerCase() === normalized.toLowerCase(),
  );
  return key ? COURIER_DATA[key]! : DEFAULT_QUOTES;
}

export function recommendCourier(wilaya: string | null): { recommended: string; reason: string } {
  const quotes = getCourierQuotes(wilaya);
  const best = quotes
    .filter((q) => q.price !== null && q.successRate !== null)
    .sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))[0];

  if (!best || best.price === null || best.days === null || best.successRate === null) {
    return { recommended: "Yalidine", reason: "Default recommendation — no data for this wilaya." };
  }

  const dest = wilaya ?? "this destination";
  return {
    recommended: best.name,
    reason: `${best.price} DA, ${best.days[0]}–${best.days[1]} days and ${best.successRate}% delivered for ${dest}.`,
  };
}
