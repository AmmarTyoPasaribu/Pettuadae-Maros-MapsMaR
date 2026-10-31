// Small shared helpers for the open-world game.

// Per-map terrain hooks; the active map sets these when it starts.
// groundHeight(x, z, y) may use the current height y to pick a floor in multi-storey interiors;
// ceilingAt(x, z, y) caps the camera indoors.
export const env = { groundHeight: () => 0, ceilingAt: () => Infinity, limit: 1285 };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Deterministic PRNG so the generated world is identical on every load.
export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
