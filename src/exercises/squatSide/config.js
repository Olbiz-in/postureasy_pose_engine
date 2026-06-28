// Side-view squat config — torso lean tolerance + hip-depth lines.
// Ported verbatim from fitness_posture sideSquatConstants.

export const SIDE_SQUAT_CFG = {
  visibility_threshold: 0.5,
  squat_max_reps: 0,

  // Torso tolerance (degrees from vertical)
  torso_lean_max_deg: 30.0,
  torso_lean_tolerance: 10.0,

  // Hip depth lines — % of calibrated ankle-to-hip stand gap
  depth_enter_pct: 15.0,
  depth_return_pct: 8.0,
  depth_partial_pct: 50.0,
  depth_too_deep_pct: 75.0,
  depth_smooth_frames: 3,

  stand_gap_min: 0.08,
  calib_lock_frames: 40,
};

export const SIDE_SQUAT_FEEDBACK = {
  torso_lean: 'You are leaning too far forward',
  squat_too_deep: 'Too deep — rise up slightly',
  squat_go_deeper: 'Go a little deeper',
  partial_rep: 'Partial rep — go a little deeper',
};

export const FORM_COLORS = {
  green: 'rgb(34,211,166)',
  yellow: 'rgb(245,158,11)',
  red: 'rgb(239,68,68)',
};
