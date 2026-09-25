// Tolerance slider definitions for the live-tracking settings UI.
// Sliders mutate live CFG / PUSHUP_CFG objects so overlays update every frame.

import { CFG, CFG_DEFAULTS, resetSquatCfg } from './squat/config.js';
import { PUSHUP_CFG } from './pushup/config.js';
import { SP_CFG, SP_CFG_DEFAULTS, resetShoulderPressCfg } from './shoulderPress/config.js';

export const PUSHUP_CFG_DEFAULTS = {
  wrist_align_ratio_max: 0.06,
  elbow_align_ratio_max: 0.05,
  wrist_elbow_collinear_ratio_max: 0.06,
  hand_rotation_ratio_max: 0.08,
  knee_align_ratio_max: 0.12,
};

export const SQUAT_TOLERANCE_GROUPS = [
  {
    title: 'Stance Width',
    color: '#56cf7b',
    keys: ['shoulder_ankle_tolerance'],
    sliders: [
      {
        key: 'shoulder_ankle_tolerance',
        label: 'Ankle vs shoulder width',
        min: 0.05,
        max: 0.45,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Knee Alignment',
    color: '#4ecdc4',
    keys: ['knee_align_ratio_max', 'kn_left_inner_offset_ratio', 'kn_left_outer_offset_ratio', 'kn_right_inner_offset_ratio', 'kn_right_outer_offset_ratio'],
    sliders: [
      { key: 'knee_align_ratio_max', label: 'Main tolerance', min: 0.02, max: 0.35, step: 0.005 },
      { key: 'kn_left_inner_offset_ratio', label: 'Left inner', min: 0, max: 0.15, step: 0.005 },
      { key: 'kn_left_outer_offset_ratio', label: 'Left outer', min: 0, max: 0.15, step: 0.005 },
      { key: 'kn_right_inner_offset_ratio', label: 'Right inner', min: 0, max: 0.15, step: 0.005 },
      { key: 'kn_right_outer_offset_ratio', label: 'Right outer', min: 0, max: 0.15, step: 0.005 },
    ],
  },
  {
    title: 'Ankle / Foot (exercise form)',
    color: '#56cf7b',
    keys: ['shoulder_foot_align_ratio_max', 'foot_index_align_ratio_max'],
    sliders: [
      { key: 'shoulder_foot_align_ratio_max', label: 'Ankle tolerance', min: 0.02, max: 0.35, step: 0.005 },
      { key: 'foot_index_align_ratio_max', label: 'Toe tolerance', min: 0.02, max: 0.35, step: 0.005 },
    ],
  },
  {
    title: 'Torso / Hip',
    color: '#5b8dee',
    keys: ['torso_horizontal_align_ratio_max', 'hip_align_ratio_max'],
    sliders: [
      { key: 'torso_horizontal_align_ratio_max', label: 'Torso horizontal', min: 0.02, max: 0.35, step: 0.005 },
      { key: 'hip_align_ratio_max', label: 'Hip centering', min: 0.01, max: 0.25, step: 0.005 },
    ],
  },
];

export const PUSHUP_TOLERANCE_GROUPS = [
  {
    title: 'Arm Alignment',
    color: '#4ecdc4',
    sliders: [
      { key: 'wrist_align_ratio_max', label: 'Wrist tolerance', min: 0.02, max: 0.35, step: 0.005 },
      { key: 'elbow_align_ratio_max', label: 'Elbow tolerance', min: 0.02, max: 0.35, step: 0.005 },
      { key: 'wrist_elbow_collinear_ratio_max', label: 'Forearm straightness', min: 0.01, max: 0.20, step: 0.005 },
      { key: 'hand_rotation_ratio_max', label: 'Hand rotation', min: 0.02, max: 0.30, step: 0.005 },
    ],
  },
];

export const SHOULDER_PRESS_TOLERANCE_GROUPS = [
  {
    title: 'Feet (shoulder width)',
    color: '#56cf7b',
    sliders: [
      { key: 'stance_narrow_tolerance', label: 'Feet too close', min: 0.1, max: 0.6, step: 0.01 },
      { key: 'stance_wide_tolerance', label: 'Feet too wide', min: 0.1, max: 0.8, step: 0.01 },
    ],
  },
  {
    title: 'Shoulder bend (setup)',
    color: '#5b8dee',
    sliders: [
      { key: 'torso_lean_ratio_max', label: 'Side bend tolerance', min: 0.06, max: 0.4, step: 0.005 },
      { key: 'shoulder_level_ratio_max', label: 'Shoulder level tolerance', min: 0.04, max: 0.3, step: 0.005 },
      { key: 'shrug_ratio_min', label: 'Shrug during press (0 = off)', min: 0, max: 0.9, step: 0.05 },
    ],
  },
  {
    title: 'Arm Path',
    color: '#4ecdc4',
    sliders: [
      { key: 'forearm_inner_tolerance', label: 'Wrist drift inward', min: 0.05, max: 0.4, step: 0.01 },
      { key: 'forearm_outer_tolerance', label: 'Wrist drift outward', min: 0.05, max: 0.4, step: 0.01 },
      { key: 'elbow_tuck_min_ratio', label: 'Elbow tuck (min out)', min: 0, max: 0.6, step: 0.01 },
      { key: 'top_wide_ratio_max', label: 'Top width (max out)', min: 0.2, max: 1.0, step: 0.01 },
      { key: 'symmetry_ratio_max', label: 'Left/right evenness', min: 0.08, max: 0.5, step: 0.01 },
    ],
  },
  {
    title: 'Depth & Height',
    color: '#f59e0b',
    sliders: [
      { key: 'depth_elbow_high_ratio', label: 'Elbows above shoulder (max)', min: 0, max: 0.5, step: 0.01 },
      { key: 'depth_elbow_low_ratio', label: 'Too low below shoulder', min: 0.1, max: 0.8, step: 0.01 },
      { key: 'top_height_ratio', label: 'Target height (arm length)', min: 0.5, max: 1.0, step: 0.01 },
      { key: 'lockout_angle_min', label: 'Lockout elbow angle (°)', min: 140, max: 178, step: 1 },
      { key: 'rep_min_sec', label: 'Min rep time (s)', min: 0.5, max: 3, step: 0.1 },
    ],
  },
];

export function getShoulderPressToleranceConfig() {
  return { CFG: SP_CFG, defaults: SP_CFG_DEFAULTS, reset: resetShoulderPressCfg };
}

export function getSquatToleranceConfig() {
  return { CFG, defaults: CFG_DEFAULTS, reset: resetSquatCfg };
}

export function getPushUpToleranceConfig() {
  return { CFG: PUSHUP_CFG, defaults: { ...PUSHUP_CFG, ...PUSHUP_CFG_DEFAULTS } };
}
