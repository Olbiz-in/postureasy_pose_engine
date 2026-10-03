// Front-view standing stance check shared by the dumbbell exercises
// (upright, feet ≈ shoulder width, arms down, facing the camera).
//
// `g` is an exercise geometry snapshot with at least:
//   sw, torsoDist, shMid, hipMid, shY, hipY, feetOk, la, ra,
//   left / right: { ok, wrist, lineY }
// `cfg` supplies the thresholds; cue keys are `${prefix}<rule>`.

function armDown(g, a, cfg) {
  if (!a.ok) return false;
  const nearHip = a.wrist.y >= g.hipY - cfg.arms_down_hip_margin * g.sw;
  if (nearHip) return true;
  const minBelow = cfg.arms_down_below_shoulder_min;
  return minBelow != null && (a.wrist.y - a.lineY) / g.sw >= minBelow;
}

/**
 * Every stance rule, each with its own pass flag, so the overlay can show a
 * checklist. `maxSw` is the widest shoulder span seen so far during setup.
 */
export function evaluateFrontStance(g, maxSw, cfg, prefix) {
  const cueKeys = [];
  const sw = g.sw;

  const facingRatio = maxSw > 0 ? sw / maxSw : 1;
  const swTorso = sw / g.torsoDist;
  const facing = facingRatio >= cfg.facing_min_ratio && swTorso >= cfg.facing_sw_torso_min;
  if (!facing) cueKeys.push(`${prefix}facing`);

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
    stanceRatio = Math.abs(g.la.x - g.ra.x) / sw;
    if (stanceRatio < cfg.stance_min) cueKeys.push(`${prefix}feet_narrow`);
    else if (stanceRatio > cfg.stance_max) cueKeys.push(`${prefix}feet_wide`);
    else feet = true;
  }

  const armsDown = armDown(g, g.left, cfg) && armDown(g, g.right, cfg);
  if (!armsDown) cueKeys.push(`${prefix}arms_not_down`);

  return {
    ok: cueKeys.length === 0,
    cueKeys,
    checks: { facing, upright, feet, armsDown },
    values: { facingRatio, swTorso, lean, torsoH, hipAboveAnkle, stanceRatio },
  };
}
