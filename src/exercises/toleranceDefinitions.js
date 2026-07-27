// Tolerance slider definitions for the live-tracking settings UI.
// Sliders mutate live CFG / PUSHUP_CFG objects so overlays update every frame.

import { CFG, CFG_DEFAULTS, resetSquatCfg } from './squat/config.js';
import { PUSHUP_CFG } from './pushup/config.js';

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

export function getSquatToleranceConfig() {
  return { CFG, defaults: CFG_DEFAULTS, reset: resetSquatCfg };
}

export function getPushUpToleranceConfig() {
  return { CFG: PUSHUP_CFG, defaults: { ...PUSHUP_CFG, ...PUSHUP_CFG_DEFAULTS } };
}
