// Small numeric / geometry helpers shared by the front-view exercise modules.

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** 0 at or below `from`, 1 at or above `to`. */
export function ramp(v, from, to) {
  if (!(to > from)) return v > from ? 1 : 0;
  return clamp01((v - from) / (to - from));
}

export function round2(v) {
  return Math.round(v * 100) / 100;
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Fixed-precision number for CSV-style debug logs ('' when missing). */
export function fmt(v, d = 3) {
  return v == null || !Number.isFinite(v) ? '' : v.toFixed(d);
}

/** First key of `keys` in `priority` order (falls back to the first key). */
export function firstByPriority(keys, priority) {
  const set = new Set(keys);
  for (const k of priority) if (set.has(k)) return k;
  return keys[0] || null;
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
