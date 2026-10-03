// Flight table (flight -> gate) and bag generator.
// Fictional flights. The table is what a baggage handling system would get from the airport's flight information system.

export const FLIGHTS = [
  { code: 'SK 1421', dest: 'København', gate: 1 },
  { code: 'DY 4412', dest: 'Oslo', gate: 1 },
  { code: 'LH 2461', dest: 'Frankfurt', gate: 2 },
  { code: 'KL 1062', dest: 'Amsterdam', gate: 2 },
  { code: 'BA 0821', dest: 'London', gate: 3 },
  { code: 'AY 0954', dest: 'Helsinki', gate: 3 },
];

const UNKNOWN_FLIGHTS = ['XX 9999', 'ZZ 0001'];
export const INVALID_SHARE = 0.1;

// Small seeded PRNG (mulberry32) so tests are repeatable.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const defectText = {
  unreadable: 'Bagagemærket kan ikke aflæses',
  unknown: 'Flyet findes ikke i flytabellen',
};

// Returns what the bag physically is. `gate` is what the system can derive from the tag (0 = no valid destination).
export function generateBagSpec(rng) {
  const weight = Math.round(8 + rng() * 24); // 8-32 kg
  const len = Math.round(30 + ((weight - 8) / 24) * 16); // 30-46 units along the belt
  const r = rng();
  if (r < INVALID_SHARE / 2) {
    const f = FLIGHTS[Math.floor(rng() * FLIGHTS.length)];
    return { flight: f.code, dest: f.dest, gate: 0, defect: 'unreadable', weight, len };
  }
  if (r < INVALID_SHARE) {
    return { flight: UNKNOWN_FLIGHTS[Math.floor(rng() * UNKNOWN_FLIGHTS.length)], dest: '–', gate: 0, defect: 'unknown', weight, len };
  }
  const f = FLIGHTS[Math.floor(rng() * FLIGHTS.length)];
  return { flight: f.code, dest: f.dest, gate: f.gate, defect: null, weight, len };
}
