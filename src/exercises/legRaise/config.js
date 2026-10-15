// Lying leg raise (side view) — thresholds, score weights, coaching text and
// voice lines.
//
// The person lies on their back, side-on to the camera, and lifts straight
// legs to ~90°, lowers them to ~45° (never all the way to the floor), and
// lifts again. Everything is measured with ONE angle:
//
//   leg angle θ = angle between the torso line (shoulder → hip) and the leg
//                 line (hip → ankle), signed so that + = legs above the floor.
//                 0° = legs flat along the floor, 90° = legs vertical.
//
// Measuring against the person's own torso line (not the image axes) keeps the
// numbers valid whatever the camera tilt or which way the head points.
//
// All numeric defaults are live-mutable via LGR_CFG so they can be tuned
// against real footage without code changes.

import { LM } from '../../core/landmarks.js';

export const LGR_TRACKED_LANDMARKS = [
  LM.NOSE,
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export const LGR_CFG_DEFAULTS = {
  // ── Landmark quality / smoothing (LandmarkSmoother contract) ─────────────
  min_visibility: 0.4, // lying side-on, the far limbs are often low-confidence
  smoothing: 'one_euro',
  one_euro_min_cutoff: 1.2,
  one_euro_beta: 0.01,
  one_euro_d_cutoff: 1.0,
  moving_average_frames: 5,
  occlusion_hold_sec: 0.35,
  person_lost_sec: 0.8, // no usable pose this long mid-rep → the attempt is dropped

  // ── Setup (lying flat, legs down, side-on) ───────────────────────────────
  lying_torso_max_deg: 30, // shoulder→hip line may tilt this far from horizontal
  legs_down_max_deg: 30, // legs must rest this close to the floor to start
  legs_down_min_deg: -30,
  calib_hold_sec: 1.2, // every check must pass continuously this long
  calib_max_samples: 45,
  calib_min_samples: 8,
  calib_still_max_deg: 8, // leg-angle range allowed while sampling
  ready_sec: 1.0, // settle before counting starts

  // ── Rep state machine (angles in degrees, + = above the floor) ───────────
  rep_enter_deg: 50, // legs above this → a rep is under way
  turn_amp_deg: 15, // a reversal this large confirms a peak / valley
  count_min_deg: 70, // a rep must peak at least this high to count
  settle_sec: 0.6, // legs still this long while lowering → the rep is over
  settle_band_deg: 4,
  min_rep_sec: 0.5, // shorter cycles are jitter, not reps
  max_rep_sec: 20, // a cycle stuck this long is dropped

  // ── Targets / form rules ─────────────────────────────────────────────────
  top_target_deg: 90, // ideal top
  top_min_deg: 80, // peak below this → "raise higher" (still counted ≥ count_min_deg)
  bottom_target_deg: 45, // ideal bottom
  bottom_max_deg: 60, // valley above this → "lower further"
  too_low_deg: 30, // valley below this → legs dropped too close to the floor
  top_band_deg: 10, // drawn tolerance around the top target
  bottom_band_deg: 12, // drawn tolerance around the bottom target
  knee_min_deg: 150, // hip-knee-ankle angle below this = bent knees
  hip_lift_deg: 12, // torso tilt change vs calibration = hips / back leaving the floor
  not_lying_deg: 40, // torso tilt change this large = sat up / got up
  turned_away_ratio: 0.55, // live torso length / calibrated below this = not side-on
  fault_min_sec: 0.3, // a fault must persist this long inside a rep to count
  live_sustain_sec: 0.3, // a live fault must hold this long before it is acted on
  min_tempo_sec: 1.4, // a full rep faster than this = momentum, not control

  // Where each component score reaches 0 (linear ramp from its tolerance).
  clean_score_min: 75,

  // ── Voice ────────────────────────────────────────────────────────────────
  voice_cooldown_ms: 10_000, // same correction never repeats sooner than this
  voice_gap_sec: 3.0, // different corrections are spaced at least this far apart

  // ── Debug ────────────────────────────────────────────────────────────────
  debug: false,
};

/** Live mutable config. */
export const LGR_CFG = { ...LGR_CFG_DEFAULTS };

export function resetLegRaiseCfg() {
  Object.assign(LGR_CFG, LGR_CFG_DEFAULTS);
}

export function setLegRaiseDebug(on) {
  LGR_CFG.debug = !!on;
  return LGR_CFG.debug;
}

// Issue → score group. Each group seen in a rep subtracts its weight once.
export const LGR_ISSUE_GROUP = {
  lgr_not_high_enough: 'range',
  lgr_not_lowering: 'lowering',
  lgr_too_low: 'lowering',
  lgr_knees_bent: 'legs',
  lgr_hips_lifting: 'hips',
  lgr_too_fast: 'tempo',
};

export const LGR_SCORE_WEIGHTS = {
  range: 30,
  lowering: 20,
  legs: 20,
  hips: 15,
  tempo: 15,
};

// Rep-level issue priority — decides which single message is shown / voiced.
export const LGR_ISSUE_PRIORITY = [
  'lgr_knees_bent',
  'lgr_hips_lifting',
  'lgr_too_low',
  'lgr_not_high_enough',
  'lgr_not_lowering',
  'lgr_too_fast',
];

// Setup-check cue priority — one corrective message at a time.
export const LGR_SETUP_PRIORITY = [
  'lgr_no_person',
  'lgr_body_not_visible',
  'lgr_not_lying',
  'lgr_legs_not_down',
  'lgr_hold_still',
];

export const LGR_FEEDBACK = {
  lgr_no_person: 'Lie down in front of the camera',
  lgr_body_not_visible: 'Move back — shoulders, hips and feet must be visible',
  lgr_not_lying: 'Lie flat on your back, side-on to the camera',
  lgr_legs_not_down: 'Rest your legs straight on the floor',
  lgr_hold_still: 'Hold still',
  lgr_ready: 'Calibrated. Start your leg raises.',

  lgr_not_high_enough: 'Raise your legs higher — up to 90°.',
  lgr_not_lowering: 'Lower your legs further — down to about 45°.',
  lgr_too_low: 'Don\'t drop your legs below 45° — keep your core tight.',
  lgr_knees_bent: 'Keep your legs straight.',
  lgr_hips_lifting: 'Keep your lower back and hips flat on the floor.',
  lgr_too_fast: 'Slow down — lift and lower with control.',

  lgr_turned_away: 'Lie side-on to the camera to continue',
  lgr_sat_up: 'Lie back down to continue',
  lgr_out_of_frame: 'Out of frame',
};

export const LGR_VOICE_MSG = {
  setup_begin: 'Lie on your back, side on to the camera, with your legs straight on the floor.',
  lgr_no_person: 'Please lie down in front of the camera.',
  lgr_body_not_visible: 'Move back so your shoulders, hips and feet are all visible.',
  lgr_not_lying: 'Lie flat on your back, side on to the camera.',
  lgr_legs_not_down: 'Rest your legs straight on the floor to begin.',
  lgr_ready: 'Calibrated. Start your leg raises.',

  lgr_not_high_enough: 'Raise your legs higher, up to ninety degrees.',
  lgr_not_lowering: 'Lower your legs further, down to about forty five degrees.',
  lgr_too_low: 'Do not drop your legs below forty five degrees. Keep your core tight.',
  lgr_knees_bent: 'Keep your legs straight.',
  lgr_hips_lifting: 'Keep your lower back and hips flat on the floor.',
  lgr_too_fast: 'Slow down. Lift and lower with control.',
};

export const LGR_COLOR_GREEN = 'rgb(0,255,0)';
export const LGR_COLOR_AMBER = 'rgb(255,190,0)';
export const LGR_COLOR_RED = 'rgb(255,0,0)';
export const LGR_COLOR_GREY = 'rgb(170,170,170)';
