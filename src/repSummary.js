// Final session summaries for exercises whose sets the app runs one at a time
// (squat, push-up, shoulder press, lunge, leg raise, plank). Same shape as the
// set-flow trackers so either app can render one summary card.

const avg = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
}
const avgTenths = (xs) => {
  const v = avg(xs.map((x) => (typeof x === 'number' ? x * 10 : null)))
  return v == null ? null : v / 10
}
const share = (n, total) => (total ? Math.round((n / total) * 100) : null)

const hasGroup = (...groups) => (r) => groups.some((g) => r.groups.includes(g))
const hasIssue = (...keys) => (r) => keys.some((k) => r.issues.includes(k))
const mean = (field) => (reps) => avg(reps.map((r) => r[field]))
const freeOf = (...groups) => (reps) => share(reps.filter((r) => !hasGroup(...groups)(r)).length, reps.length)
const accuracy = (reps) => share(reps.filter((r) => r.clean).length, reps.length)

const SQUAT_DEPTH_ROWS = [
  ['notDeepEnough', 'Not deep enough', hasIssue('squat_go_deeper')],
  ['tooDeep', 'Too deep', hasIssue('squat_too_deep')],
]

export const REP_SUMMARY_CONFIG = {
  'squat-front': {
    title: 'Squat',
    romField: 'depthPct',
    romLabel: 'Depth',
    metrics: [
      ['Accuracy', accuracy],
      ['Depth', mean('depthPct')],
      ['Symmetry', mean('symmetryPct')],
      ['Knee Tracking', freeOf('knee')],
      ['Torso Control', freeOf('torso', 'shoulder')],
      ['Tempo Control', freeOf('tempo')],
    ],
    mistakes: [
      ...SQUAT_DEPTH_ROWS,
      ['knees', 'Knees caving / flaring', hasGroup('knee')],
      ['torso', 'Leaning forward / sideways', hasGroup('torso')],
      ['hip', 'Hip shift', hasGroup('hip')],
      ['feet', 'Feet / ankle position', hasGroup('feet')],
      ['shoulder', 'Uneven shoulders', hasGroup('shoulder')],
      ['balance', 'Uneven legs', hasGroup('balance')],
      ['tempo', 'Too fast / too slow', hasGroup('tempo')],
    ],
  },
  'squat-side': {
    title: 'Squat',
    romField: 'depthPct',
    romLabel: 'Depth',
    metrics: [
      ['Accuracy', accuracy],
      ['Depth', mean('depthPct')],
      ['Full-Depth Reps', (reps) => share(reps.filter((r) => r.fullDepth).length, reps.length)],
      ['Torso Control', freeOf('torso')],
      ['Tempo Control', freeOf('tempo')],
    ],
    mistakes: [
      ...SQUAT_DEPTH_ROWS,
      ['torso', 'Leaning forward', hasGroup('torso')],
      ['tempo', 'Too fast / too slow', hasGroup('tempo')],
    ],
  },
  'pushup-front': {
    title: 'Push-up',
    romField: 'depthPct',
    romLabel: 'Depth',
    metrics: [
      ['Accuracy', accuracy],
      ['Depth', mean('depthPct')],
      ['Symmetry', mean('symmetryPct')],
      ['Elbow Alignment', freeOf('elbow', 'forearm')],
      ['Wrist Alignment', freeOf('wrist')],
      ['Tempo Control', freeOf('tempo')],
    ],
    mistakes: [
      ['tooDeep', 'Too deep', hasGroup('depth')],
      ['elbow', 'Elbows misaligned', hasGroup('elbow')],
      ['forearm', 'Forearms not vertical', hasGroup('forearm')],
      ['wrist', 'Wrists misaligned', hasGroup('wrist')],
      ['symmetry', 'Uneven arms', hasGroup('symmetry')],
      ['tempo', 'Too fast', hasGroup('tempo')],
    ],
  },
  'pushup-side': {
    title: 'Push-up',
    romField: 'depthPct',
    romLabel: 'Depth',
    metrics: [
      ['Accuracy', accuracy],
      ['Depth', mean('depthPct')],
      ['Back Alignment', mean('backPct')],
      ['Full Extension', freeOf('extension')],
      ['Hand Placement', freeOf('hand')],
      ['Tempo Control', freeOf('tempo')],
    ],
    mistakes: [
      ['sagging', 'Hips sagging', hasIssue('back_sagging')],
      ['piking', 'Hips piking', hasIssue('back_piking')],
      ['notDeepEnough', 'Not deep enough', hasIssue('pushup_not_deep_enough')],
      ['tooDeep', 'Too deep', hasIssue('pushup_too_deep', 'pushup_shoulder_deep')],
      ['partial', 'No full extension', hasGroup('extension')],
      ['hand', 'Hand placement', hasGroup('hand')],
      ['tempo', 'Too fast', hasGroup('tempo')],
    ],
  },
  'lunge-front': {
    title: 'Lunge',
    romField: 'depthPct',
    romLabel: 'Depth',
    metrics: [
      ['Accuracy', accuracy],
      ['Depth', mean('depthPct')],
      ['Symmetry', mean('symmetryPct')],
      ['Knee Alignment', freeOf('knee')],
      ['Hip & Pelvis Stability', freeOf('hip', 'pelvis')],
      ['Balance', freeOf('balance')],
      ['Tempo Control', freeOf('tempo')],
    ],
    mistakes: [
      ['notDeepEnough', 'Not deep enough', hasIssue('lunge_shallow')],
      ['knees', 'Knee caving inward', hasGroup('knee')],
      ['hip', 'Hip shift', hasGroup('hip')],
      ['pelvis', 'Uneven hips', hasGroup('pelvis')],
      ['balance', 'Swaying / unsteady', hasGroup('balance')],
      ['symmetry', 'Uneven legs', hasGroup('symmetry')],
      ['tempo', 'Dropping too fast', hasGroup('tempo')],
    ],
  },
  'lunge-side': {
    title: 'Lunge',
    romField: 'depthPct',
    romLabel: 'Depth',
    metrics: [
      ['Accuracy', accuracy],
      ['Depth', mean('depthPct')],
      ['Knee Flexion', (reps) => avg(reps.map((r) => r.components?.kneeFlex))],
      ['Torso Control', freeOf('torso')],
      ['Balance', freeOf('balance')],
      ['Tempo Control', freeOf('tempo')],
    ],
    mistakes: [
      ['notDeepEnough', 'Not deep enough', hasIssue('lunge_shallow')],
      ['torso', 'Leaning too far forward', hasGroup('torso')],
      ['balance', 'Unsteady movement', hasGroup('balance')],
      ['tempo', 'Dropping too fast', hasGroup('tempo')],
    ],
  },
  'legraise-side': {
    title: 'Leg Raise',
    romField: 'romPct',
    romLabel: 'Range of Motion',
    metrics: [
      ['Accuracy', accuracy],
      ['Range of Motion', mean('romPct')],
      ['Top Height', (reps) => share(reps.filter((r) => !hasIssue('lgr_not_high_enough')(r)).length, reps.length)],
      ['Lowering Control', freeOf('lowering')],
      ['Straight Legs', freeOf('legs')],
      ['Hips Down', freeOf('hips')],
      ['Tempo Control', freeOf('tempo')],
    ],
    mistakes: [
      ['notHigh', 'Not raising legs to 90°', hasIssue('lgr_not_high_enough')],
      ['notLowering', 'Not lowering to 45°', hasIssue('lgr_not_lowering')],
      ['tooLow', 'Legs dropping too low', hasIssue('lgr_too_low')],
      ['kneesBent', 'Knees bent', hasGroup('legs')],
      ['hips', 'Hips / back lifting', hasGroup('hips')],
      ['tempo', 'Too fast', hasGroup('tempo')],
    ],
  },
  'shoulderpress-front': {
    title: 'Dumbbell Shoulder Press',
    romField: 'romPct',
    romLabel: 'Press Height',
    metrics: [
      ['Accuracy', accuracy],
      ['Press Height', mean('romPct')],
      ['Symmetry', freeOf('symmetry')],
      ['Arm Path', freeOf('forearm', 'elbow')],
      ['Stability', freeOf('torso', 'shoulder', 'stance')],
    ],
    mistakes: [
      ['notHighEnough', 'Not pressing all the way up', hasIssue('sp_press_higher')],
      ['tooDeep', 'Lowering too far', hasIssue('sp_too_deep')],
      ['notLowEnough', 'Not lowering to shoulders', hasIssue('sp_not_low_enough')],
      ['forearm', 'Wrists not over elbows', hasGroup('forearm')],
      ['elbow', 'Elbows tucked', hasGroup('elbow')],
      ['symmetry', 'Uneven arms', hasGroup('symmetry')],
      ['torso', 'Leaning sideways', hasGroup('torso')],
      ['shoulder', 'Uneven shoulders', hasGroup('shoulder')],
      ['tempo', 'Too fast', hasGroup('tempo')],
    ],
  },
}

export function repSummaryConfig(family, view) {
  return REP_SUMMARY_CONFIG[`${family}-${view}`] || REP_SUMMARY_CONFIG[`${family}-front`] || null
}

/**
 * Session summary for app-managed rep exercises (all sets).
 * `repEvents` are the tracker rep events, each tagged with `set` by the app.
 */
export function summarizeReps(family, view, repEvents, {
  setsCompleted = 1, targetSets = 0, activeSec = 0, stoppedEarly = false,
} = {}) {
  const cfg = repSummaryConfig(family, view)
  if (!cfg) return null
  const reps = (repEvents || []).map((e, i) => {
    const issues = Array.isArray(e.issues) ? e.issues : (Array.isArray(e.errors) ? e.errors : [])
    return {
      ...e,
      attempt: i + 1,
      rep: e.index ?? i + 1,
      set: e.set ?? 1,
      counted: true,
      issues,
      groups: Array.isArray(e.groups) ? e.groups : [],
      clean: issues.length === 0,
      score: typeof e.score === 'number' ? e.score : null,
      romPct: typeof e[cfg.romField] === 'number' ? e[cfg.romField] : null,
    }
  })
  const n = reps.length

  let best = null
  let worst = null
  for (const r of reps) {
    if (r.romPct == null) continue
    if (!best || r.romPct > best.romPct) best = r
    if (!worst || r.romPct < worst.romPct) worst = r
  }

  const formScore = avg(reps.map((r) => r.score))
  const metrics = cfg.metrics.map(([label, fn]) => [label, n ? fn(reps) : null])
  const acc = n ? accuracy(reps) : null
  const rom = avg(reps.map((r) => r.romPct))

  return {
    variant: `${family}-${view}`,
    attempts: n,
    repsCompleted: n,
    cleanReps: reps.filter((r) => r.clean).length,
    setsCompleted,
    targetSets,
    partialSetReps: 0,
    stoppedEarly,
    formScore,
    accuracy: acc,
    romPct: rom,
    romBest: best ? { romPct: best.romPct } : null,
    romWorst: worst ? { romPct: worst.romPct } : null,
    metrics,
    activeSec: Math.round(activeSec),
    avgRepSec: avgTenths(reps.map((r) => r.durationSec)),
    mistakes: Object.fromEntries(cfg.mistakes.map(([key, , test]) => [key, reps.filter(test).length])),
    perRep: reps.map((r) => ({
      attempt: r.attempt,
      rep: r.rep,
      set: r.set,
      counted: true,
      clean: r.clean,
      score: r.score ?? 0,
      romPct: r.romPct,
      issues: r.issues,
    })),
    summaryLine: n
      ? `Form Score ${formScore ?? '—'}/100, Accuracy ${acc}%${rom != null ? `, ${cfg.romLabel} ${rom}%` : ''}`
      : 'No reps recorded',
  }
}

/** Session summary for timed holds (plank), one entry per set. */
export function summarizeHolds(holds, { targetSets = 0, stoppedEarly = false } = {}) {
  const list = holds || []
  const n = list.length
  const totalHold = list.reduce((a, h) => a + (h.durationSec || 0), 0)
  const totalGood = list.reduce((a, h) => a + (h.goodSec || 0), 0)
  const faults = {}
  for (const h of list) {
    for (const [k, sec] of Object.entries(h.faults || {})) faults[k] = (faults[k] || 0) + sec
  }
  for (const k of Object.keys(faults)) faults[k] = Math.round(faults[k])
  const formScore = avg(list.map((h) => h.score))

  return {
    holds: n,
    setsCompleted: n,
    targetSets,
    stoppedEarly,
    formScore,
    totalHoldSec: Math.round(totalHold),
    goodPct: share(totalGood, totalHold),
    targetPct: avg(list.map((h) => h.targetPct)),
    bodyLinePct: avg(list.map((h) => h.bodyLinePct)),
    completedHolds: list.filter((h) => h.completed).length,
    longestHoldSec: Math.round(Math.max(0, ...list.map((h) => h.durationSec || 0))),
    pauses: list.reduce((a, h) => a + (h.pauseCount || 0), 0),
    faults,
    perHold: list.map((h, i) => ({
      set: i + 1,
      holdSec: Math.round(h.durationSec || 0),
      targetSec: h.targetSec || 0,
      score: h.score ?? 0,
      completed: !!h.completed,
    })),
    summaryLine: n
      ? `Form Score ${formScore ?? '—'}/100, held ${Math.round(totalHold)}s in ${n} set${n === 1 ? '' : 's'}`
      : 'No holds recorded',
  }
}
