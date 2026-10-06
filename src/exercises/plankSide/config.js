// Side-view plank (timed hold) thresholds. Body-line deviations are normalised
// by shoulder→ankle length; head / stacking offsets by torso (shoulder→hip)
// length. All geometry is measured in canvas pixels so aspect ratio is honoured.

export const PLANK_SIDE_CFG = {
  min_visibility: 0.5,
  ear_min_visibility: 0.5,

  // Position gate — the timer only runs while all of these hold.
  max_body_tilt_deg: 35,
  min_knee_in_position_deg: 115,
  position_enter_sec: 0.6,
  position_exit_sec: 1.0,

  // Hips: signed hip offset from the shoulder→ankle line (+ = sagging).
  hip_sag_ratio: 0.07,
  hip_pike_ratio: 0.08,
  hip_clear_fraction: 0.7,
  hip_near_fraction: 0.65,

  knee_bent_deg: 160,

  // Shoulders over the support point (elbow on forearms, wrist on hands).
  forearm_plank_max_elbow_deg: 125,
  shoulder_stack_ratio: 0.3,

  // Ear offset from the hip→shoulder line, extended (+ = head dropping).
  head_drop_ratio: 0.2,
  head_up_ratio: 0.25,

  fault_confirm_sec: 0.4,
  fault_clear_sec: 0.3,
  metric_smoothing_frames: 6,

  // A fault is only spoken once it has lasted this long without a break.
  fault_voice_delay_sec: 5,
  fault_voice_repeat_sec: 8,
  minor_fault_voice_repeat_sec: 15,
  milestone_every_sec: 15,
  final_warning_sec: 10,

  default_target_sec: 0,
};

// Ordered highest priority first: only the top active fault is voiced.
export const PLANK_FAULT_PRIORITY = [
  'pk_hips_sagging',
  'pk_hips_piking',
  'pk_knees_bent',
  'pk_shoulders_forward',
  'pk_shoulders_back',
  'pk_head_dropping',
  'pk_head_raised',
];

export const PLANK_MINOR_FAULTS = new Set(['pk_head_dropping', 'pk_head_raised']);

export const PLANK_FEEDBACK = {
  pk_hips_sagging: 'Hips are dropping. Move your hips up.',
  pk_hips_piking: 'Hips are too high. Move your hips down.',
  pk_knees_bent: 'Straighten your legs. Keep your knees off the floor.',
  pk_shoulders_forward: 'Shoulders too far forward. Stack them over your elbows.',
  pk_shoulders_back: 'Bring your shoulders forward, over your elbows.',
  pk_head_dropping: 'Lift your head. Keep your neck in line with your back.',
  pk_head_raised: 'Tuck your chin. Look at the floor just ahead of your hands.',
};

export const PLANK_CUE_TEXT = {
  pk_hips_sagging: 'Hips sagging — move hips UP',
  pk_hips_piking: 'Hips too high — move hips DOWN',
  pk_knees_bent: 'Knees bent — straighten your legs',
  pk_shoulders_forward: 'Shoulders ahead of support — shift back',
  pk_shoulders_back: 'Shoulders behind support — shift forward',
  pk_head_dropping: 'Head dropping — keep neck neutral',
  pk_head_raised: 'Head up — tuck your chin',
};

export const FORM_COLORS = {
  green: 'rgb(34,211,166)',
  yellow: 'rgb(245,158,11)',
  red: 'rgb(239,68,68)',
};
