// Dumbbell curl (front view) — every threshold, score weight, coaching text
// and voice line in one place.
//
// NO joint angles are used anywhere for this exercise: in a front view the
// forearm moves toward the camera, so elbow angles are unreliable. Every rule
// compares the vertical (y) position of a landmark against a horizontal
// reference line, or uses a simple distance ratio. Image y grows downward,
// so "above" = smaller y.
//
// Units (so nothing depends on camera distance or user height):
//   T  = torso length (shoulder center → hip center), distance-corrected
//   SW = shoulder width, distance-corrected
// Both come from the stance calibration and are rescaled by the live torso
// length when the user steps closer / farther afterwards.
//
// Reference lines (per arm, relative to that arm's shoulder y):
//   UPPER TOLERANCE LINE = shoulder y − upper_allowance × SW   (wrist must stay below)
//   TOP TARGET LINE      = shoulder y + top_line_offset × T    (wrist must reach)
//   BOTTOM LINE          = shoulder y + REST_SPAN × T          (calibrated resting wrist)
//
// Curl progress = (REST_SPAN − span) / (REST_SPAN − top_line_offset), where
// span = (wrist y − shoulder y) / T. 0 = arm hanging at rest, 1 = wrist on
// the top target line.

import { LM } from '../../core/landmarks';

export const DC_TRACKED_LANDMARKS = [
  LM.NOSE,
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export const DC_CURL_MODES = ['both', 'alternate'];

export const DC_CFG_DEFAULTS = {
  // ── Landmark quality / smoothing ─────────────────────────────────────────
  min_visibility: 0.5,
  smoothing: 'one_euro', // 'one_euro' | 'moving_average' | 'none'
  one_euro_min_cutoff: 1.2, // Hz — lower = smoother when still
  one_euro_beta: 0.01, // higher = less lag on fast moves (pixel space)
  one_euro_d_cutoff: 1.0,
  moving_average_frames: 5,
  // The dumbbell / forearm often hides the wrist near the top of the curl; a
  // hidden landmark keeps its last smoothed value this long.
  occlusion_hold_sec: 0.4,
  // An arm hidden longer than this mid-rep ends that arm's cycle (→ incomplete).
  arm_missing_abort_sec: 1.0,
  person_lost_sec: 0.6,

  // ── Stance check (SETUP_STANCE) — same rules as the lateral raise ────────
  stance_hold_sec: 1.0, // every check must pass continuously this long
  stance_min: 0.8, // ankle distance / shoulder width
  stance_max: 1.4,
  upright_lean_max: 0.25, // |shoulder-center x − hip-center x| / sw
  hip_above_ankle_min: 1.5, // (ankle y − hip y) / sw; smaller = crouching
  torso_height_min: 0.9, // (hip y − shoulder y) / sw; smaller = bent over
  // Wrists must hang at hip level: at most this far (/ sw) above the hip line.
  arms_down_hip_margin: 0.10,
  arms_down_below_shoulder_min: null, // no alternative rule (arms must be fully down)
  facing_min_ratio: 0.85, // live sw / max sw seen during setup
  facing_sw_torso_min: 0.45, // sw / shoulder-to-hip distance (absolute sideways guard)

  // ── Reference lines / rep detection ──────────────────────────────────────
  line_mode: 'per_side', // 'per_side' (each arm vs its own shoulder) | 'average'
  top_line_offset: 0.10, // × T below the shoulder: TOP TARGET LINE
  top_tolerance: 0.08, // × T: wrist within this below the target line = TOP reached
  upper_allowance: 0.10, // × SW above the shoulder: UPPER TOLERANCE LINE
  bottom_tolerance: 0.10, // × T: wrist within this of the resting level = fully extended
  curl_start: 0.25, // progress: the arm has left the bottom zone (rep begins)
  attempt_min_progress: 0.40, // cycles lower than this are ignored as noise
  // "Not lowering fully": after dropping this much from the peak (progress)…
  reversal_drop: 0.25,
  // …the wrist rises again this much before reaching the bottom zone.
  reversal_rise: 0.15,
  curl_mode: 'both', // 'both' (arms together) | 'alternate' (each arm is its own rep)
  pair_window_sec: 0.7, // 'both': the arms must finish their cycles this close together
  max_cycle_sec: 10, // an arm stuck mid-rep this long without reaching the top is reset
  // Used until the calibration provides personal resting values.
  rest_span_default: 1.05, // resting wrist below shoulder, × T
  rest_elbow_default: 0.60, // resting elbow below shoulder, × T

  // ── Form rules ───────────────────────────────────────────────────────────
  flag_min_sec: 0.15, // a fault must persist this long inside a rep to count
  elbow_lift_tolerance: 0.10, // × T elbow rise above its resting y
  elbow_flare_tolerance: 0.15, // × SW elbow moving outward (vs resting elbow–hip offset)
  sway_tolerance: 0.12, // × SW shoulder-center x drift during a rep
  lean_tolerance: 0.06, // fraction of torso length lost during a rep (leaning back / forward)
  shrug_tolerance: 0.05, // × T shoulder rise relative to the hips during a rep
  shoulder_tilt_max: 0.08, // × SW change of left/right shoulder y difference
  // Sway / lean / shrug are measured against the posture this long before the
  // rep started (the start of a momentum swing happens before curl_start).
  body_baseline_lookback_sec: 0.3,
  symmetry_timing_max_sec: 0.30, // |left − right top time| with no penalty
  symmetry_timing_share: 0.3, // part of the symmetry score given to timing ('both' mode)

  // Where each component score reaches 0 (linear ramp from its tolerance).
  too_high_zero_at: 0.30, // × SW above the upper line
  elbow_lift_zero_at: 0.30,
  elbow_flare_zero_at: 0.45,
  sway_zero_at: 0.40,
  lean_zero_at: 0.20,
  shrug_zero_at: 0.20,
  shoulder_tilt_zero_at: 0.30,
  symmetry_zero_at: 0.50, // height difference ramp starts at 0
  symmetry_timing_zero_at_sec: 1.0,
  rom_extension_share: 0.15, // part of the ROM score given to lowering fully
  clean_score_min: 75,

  // ── Activity detection ───────────────────────────────────────────────────
  idle_seconds: 2.0, // arms resting this long → NOT DOING EXERCISE
  turn_ratio: 0.6, // live sw / calibrated sw below this → turned away
  long_idle_seconds: 30, // pause the session timer + show a hint

  // ── Flow timing ──────────────────────────────────────────────────────────
  ready_min_sec: 1.5, // settle after the stance passes before counting starts
  ready_max_sec: 6.0,
  rest_default_sec: 30, // rest before auto-resume (Start Next Set skips it)
  rest_resume_hold_sec: 1.5, // stance held this long to auto-resume after rest

  // ── Debug ────────────────────────────────────────────────────────────────
  debug: false, // console per-frame values + on-canvas readout
  debug_log_every_n: 1, // log every Nth frame
};

/** Live mutable config — tolerance sliders write here directly. */
export const DC_CFG = { ...DC_CFG_DEFAULTS };

export function resetDumbbellCurlCfg() {
  Object.assign(DC_CFG, DC_CFG_DEFAULTS);
}

/** Toggle the per-frame debug log + on-canvas readout. */
export function setDumbbellCurlDebug(on) {
  DC_CFG.debug = !!on;
  return DC_CFG.debug;
}

/** 'both' (default) or 'alternate'. Returns the mode now in effect. */
export function setDumbbellCurlMode(mode) {
  DC_CFG.curl_mode = DC_CURL_MODES.includes(mode) ? mode : 'both';
  return DC_CFG.curl_mode;
}

// Weights of the per-rep form score (normalized, so they need not sum to 100).
export const DC_SCORE_WEIGHTS_DEFAULTS = {
  rom: 30,
  elbow: 25,
  symmetry: 20,
  stability: 25,
};
export const DC_SCORE_WEIGHTS = { ...DC_SCORE_WEIGHTS_DEFAULTS };

export function resetDumbbellCurlWeights() {
  Object.assign(DC_SCORE_WEIGHTS, DC_SCORE_WEIGHTS_DEFAULTS);
}

// Rep-level issue priority — decides which single message is shown.
export const DC_ISSUE_PRIORITY = [
  'dc_incomplete',
  'dc_too_high',
  'dc_not_high_enough',
  'dc_not_lowering',
  'dc_elbow_moving',
  'dc_swinging',
  'dc_shrugging',
  'dc_shoulders_uneven',
];

// Live (mid-rep) cue priority for the on-screen mistake box.
export const DC_LIVE_PRIORITY = [
  'dc_too_high',
  'dc_elbow_moving',
  'dc_swinging',
  'dc_shrugging',
  'dc_shoulders_uneven',
];

// Stance-check cue priority — one corrective message at a time.
export const DC_STANCE_PRIORITY = [
  'dc_no_person',
  'dc_feet_not_visible',
  'dc_facing',
  'dc_not_upright',
  'dc_feet_narrow',
  'dc_feet_wide',
  'dc_arms_not_down',
];

// On-screen text. Mistakes and stance corrections are NEVER spoken.
export const DC_FEEDBACK = {
  dc_no_person: 'Stand in front of the camera',
  dc_feet_not_visible: 'Step back — feet not visible',
  dc_facing: 'Face the camera directly',
  dc_not_upright: 'Stand up straight',
  dc_feet_narrow: 'Move your feet apart to shoulder width',
  dc_feet_wide: 'Feet too wide — bring them in to shoulder width',
  dc_arms_not_down: 'Let your arms hang straight down at your sides',
  dc_stance_ok: 'Your stance is correct. Start the exercise.',

  dc_incomplete: 'Incomplete rep — curl both arms up and down together',
  dc_incomplete_alt: 'Incomplete rep — keep your arm visible to the camera',
  dc_not_high_enough: 'Not curling high enough — bring the dumbbells up to the target line',
  dc_too_high: 'Curling too high — keep your elbows down, stop below the shoulders',
  dc_elbow_moving: 'Elbow moving too much — keep your elbows pinned to your sides',
  dc_not_lowering: 'Not lowering fully — straighten your arms at the bottom',
  dc_swinging: 'Swinging — keep your body still, don\'t lean back',
  dc_shrugging: 'Shrugging — relax your shoulders down',
  dc_shoulders_uneven: 'Shoulders uneven — keep them level',

  dc_turned_away: 'Turned away — face the camera to continue',
  dc_arms_resting: 'Arms resting',
  dc_out_of_frame: 'Out of frame',
  dc_long_idle: 'Paused — start your next rep or press Stop',
};

// Spoken lines — only stance OK / start, rep counts, set complete, rest
// prompts and the final summary (spoken by the app on Stop / completion).
export const DC_VOICE_MSG = {
  dc_stance_ok: 'Your stance is correct. Start the exercise.',
  rep: (n) => `Rep ${n}`,
  set_done: (n) => `Set ${n} complete. Take a rest.`,
  rest_over: (next) => `Rest is over. Stand in your stance with your arms down to start set ${next}.`,
  next_set: (set, total) => (total > 0 ? `Set ${set} of ${total}. Start.` : `Set ${set}. Start.`),
  all_done: 'All sets complete. Great work!',
};

export const DC_COLOR_GREEN = 'rgb(0,255,0)';
export const DC_COLOR_AMBER = 'rgb(255,190,0)';
export const DC_COLOR_RED = 'rgb(255,0,0)';
export const DC_COLOR_GREY = 'rgb(170,170,170)';
