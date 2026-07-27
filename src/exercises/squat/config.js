// Squat thresholds, coaching messages, and tolerance config — ported verbatim
// from the proven fitness_posture constants (PoseFilterConfig + TRAINER_CUES).

import { LM, nowSec } from '../../core/landmarks';

export { LM, nowSec };

export const GATE_HEAD = [
  LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_EAR, LM.RIGHT_EAR,
];
export const GATE_UPPER = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];
export const GATE_LOWER = [
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_HEEL, LM.RIGHT_HEEL,
  LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX,
];
export const FEET_LANDMARKS = new Set([
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_HEEL, LM.RIGHT_HEEL,
  LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX,
]);
export const KNEE_LANDMARKS = new Set([LM.LEFT_KNEE, LM.RIGHT_KNEE]);
export const LEFT_SIDE = new Set([
  LM.LEFT_EYE, LM.LEFT_EAR, LM.LEFT_SHOULDER, LM.LEFT_ELBOW,
  LM.LEFT_WRIST, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE,
  LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX,
]);
export const RIGHT_SIDE = new Set([
  LM.RIGHT_EYE, LM.RIGHT_EAR, LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW,
  LM.RIGHT_WRIST, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE,
  LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX,
]);

export const MSG_NO_PERSON = 'No person detected';
export const MSG_HEAD = 'Your head is not visible. Please step back.';
export const MSG_LEGS = 'Please step back until your full body is visible.';
export const MSG_FEET = 'Please step back until your full body is visible.';
export const MSG_TOO_CLOSE = 'You are too close. Step back until your full body fits the box.';
export const MSG_TOO_FAR = 'You are too far. Please step forward a little.';
export const MSG_SIDE_VIEW = 'Please face the camera directly so both sides of your body are visible.';
export const MSG_STANCE_OK = 'Your stance is perfect. Please do not move.';
export const MSG_START_SQUAT = 'Start squatting now.';
export const MSG_POOR_DETECTION = 'Unable to detect your body clearly. Please ensure good lighting and try again.';
export const SUSTAIN_SEC = 1.0;

/** Default ratio-based tolerance values (mutable at runtime via tolerance UI). */
export const CFG_DEFAULTS = {
  // Stance-phase only: |ankleWidth - shoulderWidth| / shoulderWidth must be ≤ this.
  shoulder_ankle_tolerance: 0.20,
  shoulder_foot_align_ratio_max: 0.100,
  sf_left_inner_offset_ratio: 0.04,
  sf_left_outer_offset_ratio: 0.04,
  sf_right_inner_offset_ratio: 0.04,
  sf_right_outer_offset_ratio: 0.04,
  sf_line_half_len_ratio: 0.02,
  foot_index_align_ratio_max: 0.10,
  fi_left_inner_offset_ratio: 0.0001,
  fi_left_outer_offset_ratio: 0.04,
  fi_right_inner_offset_ratio: 0.04,
  fi_right_outer_offset_ratio: 0.0001,
  fi_line_half_len_ratio: 0.02,
  knee_align_ratio_max: 0.12,
  kn_left_inner_offset_ratio: 0.04,
  kn_left_outer_offset_ratio: 0.04,
  kn_right_inner_offset_ratio: 0.04,
  kn_right_outer_offset_ratio: 0.04,
  kn_line_half_len_ratio: 0.02,
  hip_align_ratio_max: 0.070,
  hip_offset_ratio: 0.03,
  torso_horizontal_align_ratio_max: 0.10,
  torso_horizontal_offset_ratio: 0.03,
  torso_vertical_gap_min_ratio: 0.70,
  torso_vertical_gap_offset_ratio: 0.05,
  shoulder_level_align_ratio_max: 0.04,
  shoulder_level_offset_ratio: 0.02,
  keypoint_vis_min: 0.5,
  keypoint_frame_margin: 0.04,
  keypoint_bottom_margin: 0.10,
  too_close_shoulder_span_min: 0.42,
  too_close_min_missing_lower: 1,
  too_far_shoulder_span_max: 0.14,
  too_far_min_missing: 8,
  side_view_min_missing_on_one_side: 4,
  guide_box_width_ratio: 0.38,
  guide_box_height_ratio: 0.88,
  guide_box_top_ratio: 0.06,
  guide_box_inner_pad_ratio: 8.0,
  guide_box_min_body_fill_ratio: 0.52,
  squat_max_reps: 0,
  squat_time_line_anchor: 'knee',
  squat_time_line_ratio: 0.45,
  squat_between_line_from_knee_ratio: 0.50,
  squat_between_line_width_ratio: 1.10,
  tempo_gate_offset_ratio: 0.08,
  tempo_gate_hysteresis_ratio: 0.015,
  tempo_min_sec: 2.0,
  tempo_max_sec: 4.0,
  knee_angle_sustain_sec: 1.0,
  knee_angle_smooth_alpha: 0.28,
  torso_bend_sustain_sec: 1.0,
};

/** Live mutable config — tolerance sliders write here directly. */
export const CFG = { ...CFG_DEFAULTS };

/** Configurable stance-phase ankle↔shoulder width tolerance (reads live CFG). */
export function getShoulderAnkleTolerance() {
  return CFG.shoulder_ankle_tolerance;
}
// Alias matching the requested constant name; value is always live from CFG.
export const SHOULDER_ANKLE_TOLERANCE = CFG_DEFAULTS.shoulder_ankle_tolerance;

export const MIRROR_VIEW = true;

export const MIRROR_CUE_SWAP = {
  ankle_left_inner: 'ankle_right_outer',
  ankle_left_outer: 'ankle_right_inner',
  ankle_right_inner: 'ankle_left_outer',
  ankle_right_outer: 'ankle_left_inner',
  toe_left_inner: 'toe_right_outer',
  toe_left_outer: 'toe_right_inner',
  toe_right_inner: 'toe_left_outer',
  toe_right_outer: 'toe_left_inner',
  knee_left_inner: 'knee_right_outer',
  knee_left_outer: 'knee_right_inner',
  knee_right_inner: 'knee_left_outer',
  knee_right_outer: 'knee_left_inner',
  hip_left: 'hip_right',
  hip_right: 'hip_left',
  torso_x_left: 'torso_x_right',
  torso_x_right: 'torso_x_left',
  shoulder_high_left: 'shoulder_high_right',
  shoulder_high_right: 'shoulder_high_left',
};

export function cueForView(key) {
  return MIRROR_VIEW ? (MIRROR_CUE_SWAP[key] || key) : key;
}

export function viewSide(side) {
  if (!MIRROR_VIEW) return side;
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side;
}

export const TRAINER_CUES = {
  ankle_left_inner: ['Left foot → step it in', 'Left foot too wide — move inside'],
  ankle_left_outer: ['Left foot → open it out', 'Left foot too close — step wider'],
  ankle_right_inner: ['Right foot → step it in', 'Right foot too wide — move inside'],
  ankle_right_outer: ['Right foot → open it out', 'Right foot too close — step wider'],
  toe_left_inner: ['Left toes → turn inward', 'Left toes too wide — rotate in'],
  toe_left_outer: ['Left toes → spread outward', 'Left toes too close — rotate out'],
  toe_right_inner: ['Right toes → turn inward', 'Right toes too wide — rotate in'],
  toe_right_outer: ['Right toes → spread outward', 'Right toes too close — rotate out'],
  knee_left_inner: ['Left knee → push it out', 'Left knee caving — drive outward'],
  knee_left_outer: ['Left knee → bring it in', 'Left knee flaring — track your foot'],
  knee_right_inner: ['Right knee → push it out', 'Right knee caving — drive outward'],
  knee_right_outer: ['Right knee → bring it in', 'Right knee flaring — track your foot'],
  hip_left: ['Shift weight right — hips off centre', 'Centre your squat'],
  hip_right: ['Shift weight left — hips off centre', 'Centre your squat'],
  torso_x_left: ['Lean right — you\'re tilting left', 'Centre your chest'],
  torso_x_right: ['Lean left — you\'re tilting right', 'Centre your chest'],
  torso_bend: ['Chest up! Back straight', 'Don\'t bend forward'],
  shoulder_high_left: ['Drop left shoulder', 'Level your shoulders'],
  shoulder_high_right: ['Drop right shoulder', 'Level your shoulders'],
  squat_too_deep: ['Too deep! Rise up a little', 'Come up — you\'re below your knees'],
  squat_go_deeper: ['Go deeper — not a full rep yet', 'Squat lower to count this rep'],
  squat_descend_fast: ['Slow down! Going down too fast — aim 2-3 seconds down'],
  squat_descend_slow: ['Descend a bit faster — smooth 2-4 seconds total'],
  squat_ascend_fast: ['Slow down on the way up — push steadily ~1-2 seconds'],
  squat_ascend_slow: ['Push up with more power — ascent is too slow'],
  squat_rep_fast: ['Too fast! Aim for 2 to 4 seconds', 'Slow down — control the movement'],
  squat_rep_slow: ['Too slow! Push with more power', 'Speed it up — aim for 2 to 4 seconds'],
  squat_tempo_good: ['Great tempo! Keep it up', 'Perfect pace — 2 to 4 seconds'],
  squat_pace_perfect: ['Great pace! Perfect squat speed — keep this 2-4 second rhythm'],
};

export const VOICE_CUES = {
  ankle_left_inner: ['Left foot, step it in.', 'Move your left foot inward.'],
  ankle_left_outer: ['Left foot, open it out.', 'Step your left foot wider.'],
  ankle_right_inner: ['Right foot, step it in.', 'Move your right foot inward.'],
  ankle_right_outer: ['Right foot, open it out.', 'Step your right foot wider.'],
  toe_left_inner: ['Left toes, turn them in.', 'Rotate your left foot inward.'],
  toe_left_outer: ['Left toes, spread them out.', 'Rotate your left foot outward.'],
  toe_right_inner: ['Right toes, turn them in.', 'Rotate your right foot inward.'],
  toe_right_outer: ['Right toes, spread them out.', 'Rotate your right foot outward.'],
  knee_left_inner: ['Left knee, push it out.', 'Drive your left knee outward.'],
  knee_left_outer: ['Left knee, bring it in.', 'Track your left knee over your foot.'],
  knee_right_inner: ['Right knee, push it out.', 'Drive your right knee outward.'],
  knee_right_outer: ['Right knee, bring it in.', 'Track your right knee over your foot.'],
  hip_left: ['Shift your weight to the right.', 'Centre your hips, you\'re leaning left.'],
  hip_right: ['Shift your weight to the left.', 'Centre your hips, you\'re leaning right.'],
  torso_x_left: ['You\'re leaning left. Stand straight.', 'Bring your chest back to centre.'],
  torso_x_right: ['You\'re leaning right. Stand straight.', 'Bring your chest back to centre.'],
  torso_bend: ['Chest up! Back straight.', 'Don\'t bend forward. Keep your spine tall.'],
  shoulder_high_left: ['Drop your left shoulder.', 'Level up — left shoulder is too high.'],
  shoulder_high_right: ['Drop your right shoulder.', 'Level up — right shoulder is too high.'],
  squat_too_deep: ['Too deep! Rise up a little.', 'You are going too deep. Come up slightly.'],
  squat_go_deeper: ['Go a little deeper for a full rep.', 'Squat lower — you need to reach your knees.'],
  squat_rep_fast: ['Too fast. Aim for two to four seconds through the tempo gate.', 'Slow down and control the movement.'],
  squat_rep_slow: ['Too slow. Push with more power through the tempo gate.', 'Speed it up — aim for two to four seconds.'],
  squat_tempo_good: ['Great tempo. Keep it up.', 'Perfect pace — two to four seconds.'],
};

export function bgr(b, g, r) {
  return `rgb(${r},${g},${b})`;
}

export const COLOR_GREEN = bgr(0, 255, 0);
export const COLOR_RED = bgr(0, 0, 255);
export const COLOR_AMBER = bgr(0, 200, 255);

export function resetSquatCfg() {
  Object.assign(CFG, CFG_DEFAULTS);
}
