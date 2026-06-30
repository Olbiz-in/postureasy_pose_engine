// Push-up (front view) thresholds + posture config.
// Ported verbatim from the proven fitness_posture pushUpConstants — values are
// intentionally kept identical to the tuned original implementation.

export const PUSHUP_DOWN_THRESHOLD = 90; // elbow angle below → DOWN state
export const PUSHUP_UP_THRESHOLD = 150; // elbow angle above → UP state
export const PUSHUP_MIN_VIS = 0.6; // landmark visibility for rep counting

// shoulders, elbows, wrists
export const PUSHUP_REQUIRED_LM_INDICES = [11, 12, 13, 14, 15, 16];
// + index fingers, for full posture evaluation
export const PUSHUP_POSTURE_LM_INDICES = [11, 12, 13, 14, 15, 16, 19, 20];

export const PUSHUP_CFG = {
  // Wrist alignment (shoulder-width normalised, outward-biased)
  wrist_align_ratio_max: 0.06,
  wrist_left_outward_bias_ratio: 0.07,
  wrist_right_outward_bias_ratio: 0.07,
  wrist_left_inner_offset_ratio: 0.04,
  wrist_left_outer_offset_ratio: 0.12,
  wrist_right_inner_offset_ratio: 0.04,
  wrist_right_outer_offset_ratio: 0.12,

  // Elbow alignment (same outward-bias model)
  elbow_align_ratio_max: 0.05,
  elbow_left_outward_bias_ratio: 0.06,
  elbow_right_outward_bias_ratio: 0.06,
  elbow_left_inner_offset_ratio: 0.04,
  elbow_left_outer_offset_ratio: 0.1,
  elbow_right_inner_offset_ratio: 0.04,
  elbow_right_outer_offset_ratio: 0.1,

  // Hand orientation (wrist → index finger signed ratio)
  hand_rotation_ratio_max: 0.08,
  hand_left_inner_offset_ratio: 0.03,
  hand_left_outer_offset_ratio: 0.03,
  hand_right_inner_offset_ratio: 0.03,
  hand_right_outer_offset_ratio: 0.03,

  // Wrist–elbow collinearity (forearm straightness)
  wrist_elbow_collinear_ratio_max: 0.06,

  // Depth targets — elbow angle (deg) at the bottom of a rep
  depth_target_min: 80.0,
  depth_target_max: 100.0,
  depth_too_deep_threshold: 70.0,

  // Shoulder-line too-deep guide
  shoulder_deep_line_ratio: 0.5, // 0=elbow, 1=wrist
  shoulder_deep_touch_ratio: 0.015,

  // Tolerance band geometry
  near_limit_fraction: 0.85,
  line_half_len_ratio: 0.025,

  min_visibility: 0.55,
  pushup_max_reps: 0, // 0 = unlimited (target reps handled by app layer)
};

// Human-readable coaching lines keyed by posture cue.
export const PUSHUP_FEEDBACK = {
  wrist_left_inner: 'Move your left wrist inward',
  wrist_left_outer: 'Move your left wrist outward',
  wrist_right_inner: 'Move your right wrist inward',
  wrist_right_outer: 'Move your right wrist outward',
  elbow_left_inner: 'Bring your left elbow in closer',
  elbow_left_outer: 'Flare your left elbow outward',
  elbow_right_inner: 'Bring your right elbow in closer',
  elbow_right_outer: 'Flare your right elbow outward',
  forearm_left: 'Keep your left forearm straight',
  forearm_right: 'Keep your right forearm straight',
  hand_left_inner: 'Rotate your left hand inward',
  hand_left_outer: 'Rotate your left hand outward',
  hand_right_inner: 'Rotate your right hand inward',
  hand_right_outer: 'Rotate your right hand outward',
  pushup_too_deep: 'Too deep — rise up slightly',
  pushup_shoulder_deep: 'Shoulders too low — come up a little',
};

export const FORM_COLORS = {
  green: 'rgb(34,211,166)',
  yellow: 'rgb(245,158,11)',
  red: 'rgb(239,68,68)',
};

export const PUSHUP_VOICE_MSG = {
  no_person: 'No person detected.',
  upper_body_ok: 'Upper body visible. Get into push-up position when ready.',
  ready_to_start: 'Starting push-up exercise. Do rep one.',
  done: 'Congratulations. You finished every rep.',
  wrist_left_inner: 'Move your left wrist inward.',
  wrist_left_outer: 'Move your left wrist outward.',
  wrist_right_inner: 'Move your right wrist inward.',
  wrist_right_outer: 'Move your right wrist outward.',
  elbow_left_inner: 'Bring your left elbow in closer.',
  elbow_left_outer: 'Flare your left elbow outward.',
  elbow_right_inner: 'Bring your right elbow in closer.',
  elbow_right_outer: 'Flare your right elbow outward.',
  forearm_left: 'Keep your left forearm straight.',
  forearm_right: 'Keep your right forearm straight.',
  hand_left_inner: 'Rotate your left hand inward.',
  hand_left_outer: 'Rotate your left hand outward.',
  hand_right_inner: 'Rotate your right hand inward.',
  hand_right_outer: 'Rotate your right hand outward.',
  pushup_too_deep: 'Too deep! Rise up slightly.',
  pushup_shoulder_deep: 'Shoulders too low. Come up a little.',
};

export const PUSHUP_COLOR_GREEN = 'rgb(0,255,0)';
export const PUSHUP_COLOR_YELLOW = 'rgb(255,200,0)';
export const PUSHUP_COLOR_RED = 'rgb(255,0,0)';
export const PUSHUP_COLOR_AMBER = 'rgb(255,190,0)';
export const PUSHUP_COLOR_CYAN = 'rgb(0,220,255)';
