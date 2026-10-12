// Front-view standing stance check shared by the dumbbell exercises
// (upright, feet ≈ shoulder width, arms down).
//
// `g` is an exercise geometry snapshot with at least:
//   sw, torsoDist, shMid, hipMid, shY, hipY, feetOk, la, ra,
//   left / right: { ok, wrist, lineY }
// `cfg` supplies the thresholds; cue keys are `${prefix}<rule>`.

/**
 * Per-ankle stance check against the rails drawn around the shoulder midline.
 * Each ANKLE (never heel / foot index) must sit between `min / 2` and
 * `max / 2` shoulder widths from the midline on its own side, so an ankle
 * outside its rails fails even when the total ankle span is in range.
 *
 * `g` needs sw, shMid, la, ra (pixel space). Sides are screen-ordered:
 * `left` is the ankle with the smaller x.
 */
export function ankleStance(g, min, max) {
  const cx = g.shMid.x;
  const inner = min / 2;
  const outer = max / 2;
  const [lo, hi] = g.la.x <= g.ra.x ? [g.la, g.ra] : [g.ra, g.la];
  const side = (ankle, off) => {
    const status = off < inner ? 'narrow' : off > outer ? 'wide' : 'ok';
    const miss = status === 'narrow' ? inner - off : status === 'wide' ? off - outer : 0;
    return { ankle, off, status, miss };
  };
  const left = side(lo, (cx - lo.x) / g.sw);
  const right = side(hi, (hi.x - cx) / g.sw);
  const worst = left.miss >= right.miss ? left : right;
  return {
    ok: worst.status === 'ok',
    status: worst.status,
    ratio: Math.abs(g.la.x - g.ra.x) / g.sw,
    min, max,
    left, right,
  };
}

function armDown(g, a, cfg) {
  if (!a.ok) return false;
  const nearHip = a.wrist.y >= g.hipY - cfg.arms_down_hip_margin * g.sw;
  if (nearHip) return true;
  const minBelow = cfg.arms_down_below_shoulder_min;
  return minBelow != null && (a.wrist.y - a.lineY) / g.sw >= minBelow;
}

/**
 * Every stance rule, each with its own pass flag, so the overlay can show a
 * checklist.
 */
export function evaluateFrontStance(g, cfg, prefix) {
  const cueKeys = [];
  const sw = g.sw;

  const lean = Math.abs(g.shMid.x - g.hipMid.x) / sw;
  const torsoH = (g.hipY - g.shY) / sw;
  const ankleY = g.feetOk ? (g.la.y + g.ra.y) / 2 : null;
  const hipAboveAnkle = ankleY != null ? (ankleY - g.hipY) / sw : null;
  const upright = lean <= cfg.upright_lean_max
    && torsoH >= cfg.torso_height_min
    && (hipAboveAnkle == null || hipAboveAnkle >= cfg.hip_above_ankle_min);
  if (!upright) cueKeys.push(`${prefix}not_upright`);

  let stanceRatio = null;
  let feet = false;
  if (!g.feetOk) {
    cueKeys.push(`${prefix}feet_not_visible`);
  } else {
    const ankles = ankleStance(g, cfg.stance_min, cfg.stance_max);
    stanceRatio = ankles.ratio;
    if (ankles.status === 'narrow') cueKeys.push(`${prefix}feet_narrow`);
    else if (ankles.status === 'wide') cueKeys.push(`${prefix}feet_wide`);
    else feet = true;
  }

  const armsDown = armDown(g, g.left, cfg) && armDown(g, g.right, cfg);
  if (!armsDown) cueKeys.push(`${prefix}arms_not_down`);

  return {
    ok: cueKeys.length === 0,
    cueKeys,
    checks: { upright, feet, armsDown },
    values: { lean, torsoH, hipAboveAnkle, stanceRatio },
  };
}
