// Single-arm dumbbell row (side / three-quarter view) — thresholds, score
// weights, coaching text and voice lines.
//
// Same approach as the raises and the curl: every rule compares a landmark
// against a body reference line, or uses a simple distance ratio. Because the
// torso is bent over, the reference is the TORSO LINE through the working-side
// hip and shoulder (the back, seen from the side) instead of a horizontal
// shoulder line.
//
// Body frame (rebuilt every frame on the working side):
//   u = unit vector hip → shoulder (along the back, toward the head)
//   n = unit normal to u on the floor side of the back
//   T = hip–shoulder distance (torso length) — the unit of every distance
//
//   depth = (elbow − shoulder) · n / T    + = elbow below the torso line
//   back  = −(elbow − shoulder) · u / T   + = elbow behind the shoulder (toward the hip)
//
// Row progress = (REST_DEPTH − depth) / (REST_DEPTH − top_tolerance), where
// REST_DEPTH is the calibrated hanging-arm depth: 0 = arm hanging at the
// calibrated start, 1 = elbow inside the TOP band at the torso line. Every
// threshold is relative to the user's own torso and start position, so body
// proportions, torso angle and camera distance do not matter.

import { LM } from '../../core/landmarks';

export const SR_SIDE_LANDMARKS = {
  left: {
    shoulder: LM.LEFT_SHOULDER,
    elbow: LM.LEFT_ELBOW,
    wrist: LM.LEFT_WRIST,
    hip: LM.LEFT_HIP,
    knee: LM.LEFT_KNEE,
    ankle: LM.LEFT_ANKLE,
  },
  right: {
    shoulder: LM.RIGHT_SHOULDER,
    elbow: LM.RIGHT_ELBOW,
    wrist: LM.RIGHT_WRIST,
    hip: LM.RIGHT_HIP,
    knee: LM.RIGHT_KNEE,
    ankle: LM.RIGHT_ANKLE,
  },
};

export const SR_TRACKED_LANDMARKS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export const SR_CFG_DEFAULTS = {
  // ── Landmark quality / smoothing ─────────────────────────────────────────
  min_visibility: 0.5,
  smoothing: 'one_euro', // 'one_euro' | 'moving_average' | 'none'
  one_euro_min_cutoff: 1.2, // Hz — lower = smoother when still
  one_euro_beta: 0.01, // higher = less lag on fast moves (pixel space)
  one_euro_d_cutoff: 1.0,
  moving_average_frames: 5,
  // The dumbbell / torso often hides the wrist near the top; a hidden landmark
  // keeps its last smoothed value this long.
  occlusion_hold_sec: 0.4,
  // The arm hidden longer than this mid-rep drops the cycle without scoring.
  arm_missing_abort_sec: 1.0,
  person_lost_sec: 0.6,

  // ── View / readiness ─────────────────────────────────────────────────────
  // Mean raw visibility of the working shoulder, elbow, wrist and hip.
  min_view_confidence: 0.6,
  // Shoulder span / torso length above this = facing the camera, not side-on.
  view_span_max: 1.0,
  // Summed visibility lead the other side needs to become the working side…
  side_switch_margin: 0.6,
  // …held this long, and never while a rep is in progress.
  side_switch_sec: 1.5,
  // The far shoulder must be this visible for the torso-rotation metric.
  rotation_min_visibility: 0.65,

  // ── Start position (SETUP_STANCE) ────────────────────────────────────────
  setup_hold_sec: 1.0, // every check must pass continuously this long
  torso_angle_max_deg: 60, // torso above horizontal; more = too upright for a row
  setup_elbow_depth_min: 0.30, // × T elbow below the torso line (arm hanging)
  start_extension_min: 0.88, // shoulder–wrist / (upper arm + forearm); 1 = straight

  // ── Torso line / rep detection ───────────────────────────────────────────
  top_tolerance: 0.15, // × T: elbow within this below the torso line = TOP reached
  lift_start: 0.25, // progress: the arm has left the start zone (rep begins)
  lift_return: 0.15, // progress: back in the start zone (hysteresis vs lift_start)
  attempt_min_rom: 0.35, // cycles that never get this far are ignored as noise
  // A rep lowered back to the start counts once it reached this much of the
  // calibrated range (partial ROM counts, flagged); 1 = only full-ROM reps count.
  min_count_rom: 0.60,
  top_exit_drop: 0.10, // progress drop from the peak that starts the RETURN phase
  // "Not lowering fully": after dropping this much from the peak (progress)…
  reversal_drop: 0.25,
  // …the elbow rises again this much before reaching the start zone.
  reversal_rise: 0.15,
  min_cycle_sec: 0.4, // shorter cycles are landmark noise, never reps
  max_cycle_sec: 10, // a cycle stuck this long without reaching the top is reset
  // Used until the calibration provides personal start values.
  rest_depth_default: 0.65, // hanging elbow below the torso line, × T
  rest_wrist_depth_default: 1.15, // hanging wrist below the torso line, × T

  // ── Form rules ───────────────────────────────────────────────────────────
  flag_min_sec: 0.15, // a fault must persist this long inside a rep to count
  path_check_lift: 0.6, // progress above which the elbow path is judged
  // Elbow path: near the top the elbow must have travelled at least this far
  // back toward the hip (× T, vs its start position). Less = flaring out /
  // pulling straight up instead of rowing to the hip.
  elbow_back_min: 0.05,
  torso_angle_tolerance_deg: 8, // torso angle change during a rep
  rotation_tolerance: 0.12, // × T change of the far shoulder's offset across the back
  shrug_tolerance: 0.05, // fraction of torso length the shoulder slides toward the head
  min_rep_sec: 1.0, // whole rep faster than this → too fast
  min_lower_sec: 0.4, // lowering faster than this → too fast (dropping the weight)
  momentum_pull_sec: 0.3, // pulling to the top faster than this → yanking / momentum
  // Torso / shrug are measured against the posture this long before the rep started.
  body_baseline_lookback_sec: 0.3,

  // Where each component score reaches 0 (linear ramp from its tolerance).
  rom_return_share: 0.15, // part of the ROM score given to lowering fully
  elbow_path_zero_at: 0.25, // × T short of elbow_back_min
  torso_angle_zero_at_deg: 25,
  rotation_zero_at: 0.40,
  shrug_zero_at: 0.20,
  consistency_zero_at: 0.40, // ROM fraction away from the recent reps
  clean_score_min: 75,

  // ── Activity detection ───────────────────────────────────────────────────
  idle_seconds: 2.0, // arm resting this long → NOT DOING EXERCISE
  long_idle_seconds: 30, // pause the session timer + show a hint

  // ── Flow timing ──────────────────────────────────────────────────────────
  ready_min_sec: 1.5, // settle after the position check before counting starts
  ready_max_sec: 6.0,
  rest_default_sec: 30, // rest before auto-resume (Start Next Set skips it)
  rest_resume_hold_sec: 1.5, // start position held this long to auto-resume after rest

  // ── Debug ────────────────────────────────────────────────────────────────
  debug: false, // console per-frame values + on-canvas readout
  debug_log_every_n: 1, // log every Nth frame
};

/** Live mutable config — tolerance sliders write here directly. */
export const SR_CFG = { ...SR_CFG_DEFAULTS };

export function resetSingleArmDumbbellRowCfg() {
  Object.assign(SR_CFG, SR_CFG_DEFAULTS);
}

/** Toggle the per-frame debug log + on-canvas readout. */
export function setSingleArmDumbbellRowDebug(on) {
  SR_CFG.debug = !!on;
  return SR_CFG.debug;
}

// Weights of the per-rep form score (normalized, so they need not sum to 100).
// Components that cannot be measured for a rep are left out of the average.
export const SR_SCORE_WEIGHTS_DEFAULTS = {
  rom: 30,
  path: 20,
  stability: 20,
  shoulder: 10,
  tempo: 10,
  consistency: 10,
};
export const SR_SCORE_WEIGHTS = { ...SR_SCORE_WEIGHTS_DEFAULTS };

export function resetSingleArmDumbbellRowWeights() {
  Object.assign(SR_SCORE_WEIGHTS, SR_SCORE_WEIGHTS_DEFAULTS);
}

// Rep-level issue priority — decides which single message is shown / voiced.
export const SR_ISSUE_PRIORITY = [
  'sr_insufficient_rom',
  'sr_incomplete_return',
  'sr_torso_rotation',
  'sr_momentum',
  'sr_elbow_flare',
  'sr_shoulder_shrug',
  'sr_too_fast',
];

// Live (mid-rep) cue priority for the on-screen mistake box.
export const SR_LIVE_PRIORITY = [
  'sr_torso_rotation',
  'sr_elbow_flare',
  'sr_shoulder_shrug',
];

// Position-check cue priority — one corrective message at a time.
export const SR_SETUP_PRIORITY = [
  'sr_no_person',
  'sr_arm_not_visible',
  'sr_not_side_on',
  'sr_not_bent_over',
  'sr_arm_not_down',
];

export const SR_FEEDBACK = {
  sr_no_person: 'Get into the camera view',
  sr_arm_not_visible: 'Turn so your working arm is closest to the camera',
  sr_not_side_on: 'Turn side-on to the camera',
  sr_not_bent_over: 'Hinge forward — one hand and knee on the bench',
  sr_arm_not_down: 'Let the dumbbell hang with your arm straight',
  sr_stance_ok: 'Starting position set. Start rowing.',

  sr_insufficient_rom: 'Pull your elbow further back.',
  sr_elbow_flare: 'Keep your elbow closer to your body.',
  sr_torso_rotation: 'Keep your torso stable.',
  sr_shoulder_shrug: 'Keep your shoulder down.',
  sr_incomplete_return: 'Lower the dumbbell fully before the next rep.',
  sr_momentum: 'Use a controlled movement.',
  sr_too_fast: 'Slow down and control the movement.',
  sr_invalid_start: 'Set your starting position before rowing.',

  sr_out_of_frame: 'Out of frame',
  sr_low_confidence: 'Working arm not clearly visible — turn it toward the camera',
  sr_not_in_position: 'Get back into the row position',
  sr_arm_resting: 'Arm resting',
  sr_long_idle: 'Paused — start your next rep or press Stop',
};

// Spoken lines. Form corrections are only spoken once the same mistake shows
// up in two reps in a row (RepeatMistakeGate), with a per-key cooldown and a
// minimum gap between any two corrections, and never cut off the rep count.
export const SR_VOICE_MSG = {
  setup_begin: 'Put one hand and the same knee on the bench, turn your working arm toward the camera, and let the dumbbell hang straight down.',
  sr_no_person: 'Please get into the camera view.',
  sr_arm_not_visible: 'Turn so your working arm is closest to the camera.',
  sr_not_side_on: 'Turn side on to the camera.',
  sr_not_bent_over: 'Hinge forward with one hand and one knee on the bench.',
  sr_arm_not_down: 'Let the dumbbell hang with your arm straight.',
  sr_stance_ok: 'Starting position set. Start rowing.',

  sr_insufficient_rom: 'Pull your elbow further back.',
  sr_elbow_flare: 'Keep your elbow closer to your body.',
  sr_torso_rotation: 'Keep your torso stable.',
  sr_shoulder_shrug: 'Keep your shoulder down.',
  sr_incomplete_return: 'Lower the dumbbell fully before the next rep.',
  sr_momentum: 'Use a controlled movement.',
  sr_too_fast: 'Slow down. Control the way down.',
  sr_invalid_start: 'Set your starting position before rowing.',

  rep: (n) => `Rep ${n}`,
  side: (side) => `Working arm: ${side}.`,
  set_done: (n) => `Set ${n} complete. Take a rest.`,
  rest_over: (next) => `Rest is over. Get back into your starting position to start set ${next}.`,
  next_set: (set, total) => (total > 0 ? `Set ${set} of ${total}. Start.` : `Set ${set}. Start.`),
  all_done: 'All sets complete. Great work!',
};

export const SR_COLOR_GREEN = 'rgb(0,255,0)';
export const SR_COLOR_AMBER = 'rgb(255,190,0)';
export const SR_COLOR_RED = 'rgb(255,0,0)';
export const SR_COLOR_GREY = 'rgb(170,170,170)';
