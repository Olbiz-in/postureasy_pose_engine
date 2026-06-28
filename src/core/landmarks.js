// MediaPipe Pose landmark indices (BlazePose 33-point topology) plus small,
// dependency-free geometry helpers shared by every exercise.
//
// A "landmark" is the normalized point produced by MediaPipe:
//   { x: 0..1, y: 0..1, z: number, visibility: 0..1 }
// x grows left→right, y grows top→bottom (image space).

export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
};

/** Monotonic clock in seconds, matching the original engine's timing base. */
export const nowSec = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/** True when a landmark exists and clears the visibility threshold. */
export function isVisible(lm, minVisibility = 0.5) {
  return !!lm && (lm.visibility == null || lm.visibility >= minVisibility);
}

/** Mean position of several landmarks; returns null if any are missing. */
export function midpoint(...lms) {
  if (lms.some((l) => !l)) return null;
  const n = lms.length;
  return {
    x: lms.reduce((s, l) => s + l.x, 0) / n,
    y: lms.reduce((s, l) => s + l.y, 0) / n,
    z: lms.reduce((s, l) => s + (l.z || 0), 0) / n,
    visibility: Math.min(...lms.map((l) => (l.visibility == null ? 1 : l.visibility))),
  };
}

/**
 * Interior angle (degrees) at vertex `b` formed by points a-b-c.
 * Used by angle-based exercise templates (knee bend, elbow bend, etc.).
 */
export function jointAngle(a, b, c) {
  if (!a || !b || !c) return null;
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAb = Math.hypot(abx, aby);
  const magCb = Math.hypot(cbx, cby);
  if (magAb === 0 || magCb === 0) return null;
  const cos = Math.max(-1, Math.min(1, dot / (magAb * magCb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Horizontal shoulder span (normalized); a stable scale reference. */
export function shoulderWidth(landmarks) {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  if (!ls || !rs) return null;
  return Math.max(Math.abs(ls.x - rs.x), 1e-6);
}
