// Side-view push-up thresholds + posture config. Ported verbatim from the
// fitness_posture sidePushupConstants.

export const SIDE_PUSHUP_DOWN_THRESHOLD = 90;
export const SIDE_PUSHUP_UP_THRESHOLD = 150;
export const SIDE_PUSHUP_MIN_VIS = 0.6;

export const SIDE_PUSHUP_CFG = {
  back_straight_target_deg: 175.0,
  back_straight_tol_deg: 12.0,
  back_sag_threshold_deg: 155.0,
  back_pike_threshold_deg: 195.0,
  back_near_limit_fraction: 0.85,
  back_hip_dev_ratio_max: 0.12,

  depth_target_min: 80.0,
  depth_target_max: 100.0,
  depth_too_deep_threshold: 70.0,
  shoulder_deep_line_ratio: 0.5,
  shoulder_deep_touch_ratio: 0.015,

  full_extension_min_deg: 150.0,
  partial_extension_tol_deg: 5.0,

  hand_forward_ratio_max: 0.18,
  hand_low_ratio_max: 0.55,

  near_limit_fraction: 0.85,
  min_visibility: 0.55,

  pushup_max_reps: 0,
};

export const SIDE_PUSHUP_FEEDBACK = {
  back_sagging: "Keep your back straight — don't sag",
  back_piking: 'Keep your back straight — lower your hips',
  pushup_too_deep: 'Too deep — rise up slightly',
  pushup_shoulder_deep: 'Too deep — come up a little',
  pushup_not_deep_enough: 'Go a little deeper',
  pushup_partial_extension: 'Full extension at the top',
  hand_too_forward: 'Hands too far forward',
  hand_too_low: 'Hands too low',
};

export const FORM_COLORS = {
  green: 'rgb(34,211,166)',
  yellow: 'rgb(245,158,11)',
  red: 'rgb(239,68,68)',
};
