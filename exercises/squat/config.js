// Squat thresholds — the subset of the proven fitness_posture config that the
// rep tracker and knee-form monitor actually depend on. Values are intentionally
// kept identical to the original, tuned implementation.

export const CFG = {
  // Landmark gating
  keypoint_vis_min: 0.5,

  // Knee alignment tolerance bands (normalized by shoulder width)
  knee_align_ratio_max: 0.12,
  kn_left_inner_offset_ratio: 0.04,
  kn_left_outer_offset_ratio: 0.04,
  kn_right_inner_offset_ratio: 0.04,
  kn_right_outer_offset_ratio: 0.04,

  // Rep tracking
  squat_max_reps: 0, // 0 = unlimited (target reps handled by the app layer)
  squat_time_line_anchor: 'knee',
  squat_time_line_ratio: 0.45,

  // Tempo window (seconds) for "good" pacing
  tempo_min_sec: 2.0,
  tempo_max_sec: 4.0,

  // Per-rep knee posture smoothing/sustain
  knee_angle_sustain_sec: 1.0,
  knee_angle_smooth_alpha: 0.28,
};

// Selfie/mirror view: the camera feed is mirrored, so anatomical left/right are
// swapped for user-facing cue labels.
export const MIRROR_VIEW = true;

export function viewSide(side) {
  if (!MIRROR_VIEW) return side;
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side;
}
