// Lunge (front + side view) — thresholds, score weights, coaching text and
// voice lines.
//
// Every distance is divided by `norm`, the torso length (shoulder-centre →
// hip-centre) clamped around the value captured during calibration, so rules do
// not depend on camera distance, resolution or body size. Depth is the drop of
// the hip toward the ankle line as a fraction of the CALIBRATED standing
// hip-to-ankle height (0 = standing tall, 1 = hip at ankle height).
//
// The numeric defaults are starting points derived from typical lunge
// anatomy (a full lunge lowers the hip by roughly 40–50 % of its standing
// height above the ankle); they are live-mutable via LUNGE_CFG so they can be
// tuned against real footage without code changes.

import { LM } from '../../core/landmarks.js';

export const LUNGE_TRACKED_LANDMARKS = [
  LM.NOSE,
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_HEEL, LM.RIGHT_HEEL,
  LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX,
];

export const LUNGE_CFG_DEFAULTS = {
  // ── Landmark quality / smoothing (LandmarkSmoother contract) ─────────────
  min_visibility: 0.5,
  smoothing: 'one_euro',
  one_euro_min_cutoff: 1.2,
  one_euro_beta: 0.01,
  one_euro_d_cutoff: 1.0,
  moving_average_frames: 5,
  occlusion_hold_sec: 0.35, // a briefly hidden landmark keeps its last value this long
  person_lost_sec: 0.8, // no usable pose this long mid-rep → the attempt is dropped

  // ── Calibration / view validation (SETUP) ────────────────────────────────
  calib_hold_sec: 1.2, // every check must pass continuously this long
  calib_max_samples: 45,
  calib_still_max: 0.06, // hip-ankle height range / torso allowed while sampling
  stand_height_min: 1.25, // (ankle y − hip y) / torso; smaller = crouched / cut off
  upright_lean_max: 0.30, // front: |shoulder-centre x − hip-centre x| / torso
  upright_torso_deg_max: 18, // side: torso inclination from vertical
  front_sw_ratio_min: 0.60, // shoulder width / torso: below = not facing the camera
  side_sw_ratio_max: 0.45, // shoulder width / torso: above = not side-on
  side_dir_toe_min: 0.10, // |toe − heel x| / torso needed to know which way you face
  side_dir_nose_min: 0.05, // …or |nose − shoulder-centre x| / torso
  frame_margin: 0.015, // ankles must be this far (fraction of frame) inside the frame
  ready_sec: 1.0, // settle before counting starts

  // ── Rep state machine (depth = fraction of calibrated standing height) ───
  depth_enter: 0.10, // standing → descending
  depth_return: 0.055, // back to standing (hysteresis vs depth_enter)
  depth_count: 0.22, // a rep must reach this depth to count (smaller = incomplete)
  depth_target: 0.30, // at/above = adequate depth; below → "increase depth"
  depth_full: 0.40, // ROM 100 %
  turn_drop: 0.04, // depth must fall this far from the peak to start the ascent
  min_rep_sec: 0.8, // shorter cycles are jitter, not reps
  min_gap_sec: 0.35, // minimum time between two counted reps
  max_rep_sec: 15, // an attempt stuck this long is dropped
  side_knee_count_max_deg: 140, // side view: front knee must flex at least this much to count
  lock_depth: 0.14, // the front leg is locked once depth passes this
  leg_sep_side: 0.35, // |Δ ankle x| / torso needed to tell front leg from rear (side view)
  leg_sep_front: 0.12, // |Δ ankle y| / torso needed to tell front leg from rear (front view)
  restand_drift_min: 0.80, // standing height vs calibration outside [min, max] for…
  restand_drift_max: 1.25,
  restand_drift_sec: 1.5, // …this long → camera moved, recalibrate
  restand_blend: 0.02, // slow drift correction of the standing reference

  // ── Form rules (relative to the calibrated standing baseline) ────────────
  fault_min_sec: 0.2, // a fault must persist this long inside a rep to count
  live_sustain_sec: 0.3, // live red indicator needs the fault this long (no single-frame flicker)
  hysteresis: 0.75, // a latched fault clears below on_threshold × this
  knee_valgus_max: 0.20, // inward knee deviation from the hip–ankle line / torso
  knee_valgus_zero_at: 0.50,
  hip_shift_max: 0.22, // hip-centre drift off the ankle-centre / torso
  hip_shift_zero_at: 0.55,
  pelvis_tilt_max: 0.15, // |Δ hip-height difference| / torso
  pelvis_tilt_zero_at: 0.38,
  trunk_sway_max: 0.22, // |Δ shoulder-over-hip lateral offset| / torso
  trunk_sway_zero_at: 0.55,
  torso_lean_max_deg: 35, // forward inclination beyond the standing baseline
  torso_lean_zero_deg: 60,
  front_knee_good_deg: 110, // front-knee flexion this deep or deeper scores 100
  front_knee_zero_deg: 160,
  descent_min_sec: 0.6, // faster descent = uncontrolled drop
  wobble_amp: 0.05, // depth reversal bigger than this = unsteady movement
  wobble_max_reversals: 2, // extra reversals allowed beyond the real turn
  asym_max: 0.25, // relative depth gap between consecutive left/right-leg reps
  asym_zero_at: 0.60,
  clean_score_min: 75,

  // ── Voice ────────────────────────────────────────────────────────────────
  voice_cooldown_ms: 10_000, // same correction never repeats sooner than this
  voice_gap_sec: 3.0, // different corrections are spaced at least this far apart

  // ── Debug ────────────────────────────────────────────────────────────────
  debug: false,
};

/** Live mutable config. */
export const LUNGE_CFG = { ...LUNGE_CFG_DEFAULTS };

export function resetLungeCfg() {
  Object.assign(LUNGE_CFG, LUNGE_CFG_DEFAULTS);
}

// Weights of the per-rep form score (normalised over the components that were
// actually measured — a metric whose landmarks were unreliable is left out
// instead of being scored as perfect).
export const LUNGE_SCORE_WEIGHTS = {
  front: { depth: 20, knee: 25, hip: 15, pelvis: 10, balance: 15, tempo: 10, symmetry: 5 },
  side: { depth: 25, kneeFlex: 15, torso: 25, balance: 15, tempo: 20 },
};

// Issue → score component.
export const LUNGE_ISSUE_GROUP = {
  lunge_knee_collapse_left: 'knee',
  lunge_knee_collapse_right: 'knee',
  lunge_hip_shift: 'hip',
  lunge_pelvis_tilt: 'pelvis',
  lunge_trunk_sway: 'balance',
  lunge_unsteady: 'balance',
  lunge_torso_lean: 'torso',
  lunge_shallow: 'depth',
  lunge_too_fast: 'tempo',
  lunge_asymmetry: 'symmetry',
};

// Rep-level issue priority — decides which single message is shown / voiced.
export const LUNGE_ISSUE_PRIORITY = [
  'lunge_knee_collapse_left',
  'lunge_knee_collapse_right',
  'lunge_torso_lean',
  'lunge_hip_shift',
  'lunge_pelvis_tilt',
  'lunge_trunk_sway',
  'lunge_unsteady',
  'lunge_shallow',
  'lunge_too_fast',
  'lunge_asymmetry',
];

// Setup-check cue priority — one corrective message at a time.
export const LUNGE_SETUP_PRIORITY = [
  'lunge_no_person',
  'lunge_body_not_visible',
  'lunge_feet_cut',
  'lunge_face_front',
  'lunge_turn_side',
  'lunge_not_upright',
  'lunge_hold_still',
];

export const LUNGE_FEEDBACK = {
  lunge_no_person: 'Stand in front of the camera',
  lunge_body_not_visible: 'Step back — your hips, knees and feet must be visible',
  lunge_feet_cut: 'Step back — your feet are cut off',
  lunge_face_front: 'Face the camera',
  lunge_turn_side: 'Turn sideways to the camera',
  lunge_not_upright: 'Stand up straight',
  lunge_hold_still: 'Stand still',
  lunge_ready: 'Calibrated. Start your lunges.',

  lunge_knee_collapse_left: 'Keep your left knee aligned with your foot.',
  lunge_knee_collapse_right: 'Keep your right knee aligned with your foot.',
  lunge_hip_shift: 'Keep your hips centered between your feet.',
  lunge_pelvis_tilt: 'Keep your hips level.',
  lunge_trunk_sway: 'Keep your torso stable — don\'t sway sideways.',
  lunge_unsteady: 'Maintain your balance.',
  lunge_torso_lean: 'Keep your torso stable — don\'t lean too far forward.',
  lunge_shallow: 'Increase your lunge depth.',
  lunge_too_fast: 'Lower into the lunge with control.',
  lunge_asymmetry: 'Match your depth on both legs.',

  lunge_turned_away: 'Face the correct direction to continue',
  lunge_out_of_frame: 'Out of frame',
  lunge_camera_moved: 'Camera moved — hold still to recalibrate',
  lunge_incomplete: 'Lunge deeper — that rep was not counted',
};

export const LUNGE_VOICE_MSG = {
  setup_front: 'Stand facing the camera, tall, so I can see your hips, knees and feet.',
  setup_side: 'Stand sideways to the camera, tall, so I can see your hips, knees and feet.',
  lunge_no_person: 'Please stand in front of the camera.',
  lunge_body_not_visible: 'Step back so your hips, knees and feet are visible.',
  lunge_feet_cut: 'Step back so your feet are in the frame.',
  lunge_face_front: 'Face the camera.',
  lunge_turn_side: 'Turn sideways to the camera.',
  lunge_not_upright: 'Stand up straight.',
  lunge_ready: 'Calibrated. Start your lunges.',

  lunge_knee_collapse_left: 'Keep your left knee aligned with your foot.',
  lunge_knee_collapse_right: 'Keep your right knee aligned with your foot.',
  lunge_hip_shift: 'Keep your hips centered between your feet.',
  lunge_pelvis_tilt: 'Keep your hips level.',
  lunge_trunk_sway: 'Keep your torso stable.',
  lunge_unsteady: 'Maintain your balance.',
  lunge_torso_lean: 'Keep your torso stable. Do not lean too far forward.',
  lunge_shallow: 'Increase your lunge depth.',
  lunge_too_fast: 'Lower into the lunge with control.',
  lunge_asymmetry: 'Match your depth on both legs.',
};

export const LUNGE_COLOR_GREEN = 'rgb(0,255,0)';
export const LUNGE_COLOR_AMBER = 'rgb(255,190,0)';
export const LUNGE_COLOR_RED = 'rgb(255,0,0)';
export const LUNGE_COLOR_GREY = 'rgb(170,170,170)';

// Landmarks highlighted red on the overlay for each issue.
export const LUNGE_ISSUE_JOINTS = {
  lunge_knee_collapse_left: [LM.LEFT_KNEE],
  lunge_knee_collapse_right: [LM.RIGHT_KNEE],
  lunge_hip_shift: [LM.LEFT_HIP, LM.RIGHT_HIP],
  lunge_pelvis_tilt: [LM.LEFT_HIP, LM.RIGHT_HIP],
  lunge_trunk_sway: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP],
  lunge_torso_lean: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP],
  lunge_unsteady: [LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  lunge_shallow: [LM.LEFT_HIP, LM.RIGHT_HIP],
  lunge_too_fast: [LM.LEFT_HIP, LM.RIGHT_HIP],
  lunge_asymmetry: [LM.LEFT_KNEE, LM.RIGHT_KNEE],
};
