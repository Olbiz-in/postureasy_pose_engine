import fs from 'fs';

const path = new URL('../src/exercises/squat/SquatFlow.js', import.meta.url);
let s = fs.readFileSync(path, 'utf8');

s = s.replace(/import \{ useRef, useState, useCallback, useEffect \} from 'react';\n/, '');
s = s.replace(/import \{ useVoiceManager \} from '\.\.\/shared\/hooks\/useVoiceManager';\n/, "import { VoiceManager } from '../../core/voiceManager.js';\n");
s = s.replace(/from '\.\/SquatTracker'/, "from './SquatRepTracker.js'");
s = s.replace(/from '\.\/kneeAngleLogic'/, "from './kneeMonitor.js'");
s = s.replace(/from '\.\/torsoAngleLogic'/, "from './torsoMonitor.js'");
s = s.replace(/from '\.\/constants'/, "from './config.js'");
s = s.replace(/from '\.\/drawUtils'/, "from './draw.js'");

const hookIdx = s.indexOf('export function useSquatFlow');
const header = s.slice(0, hookIdx);
let body = s.slice(hookIdx);

body = body.replace(/export function useSquatFlow\(\{ targetReps = 0 \}\) \{[\s\S]*?const voice\s+=\s+useVoiceManager\(\);\n/, '');
body = body.replace(/const squatRef\s+=\s+useRef\(new SquatRepTracker\(\)\);\n/, '');
body = body.replace(/const kneeMonitorRef\s+=\s+useRef\(new KneeAngleRepMonitor\(\)\);\n/, '');
body = body.replace(/const torsoMonitorRef\s+=\s+useRef\(new TorsoBendRepMonitor\(\)\);\n/, '');
body = body.replace(/const wasInSquatRef\s+=\s+useRef\(false\);\n/, '');

const refs = [
  'phaseRef', 'boundaryStableStartRef', 'stancePassHoldStartRef', 'confirmationStartRef',
  'readyStartRef', 'fullBodyVoiceSentRef', 'stanceOkVoiceSentRef', 'doRepOneVoiceSentRef',
  'doneVoiceSentRef', 'lastSeenRepRef', 'targetRepsRef', 'wasInSquatRef',
];
for (const r of refs) {
  body = body.replace(new RegExp(`${r}\\.current`, 'g'), `this._${r.replace('Ref', '')}`);
}

body = body.replace(/const \[phase, setPhase\][^;]+;/, '');
body = body.replace(/const \[repCount, setRepCount\][^;]+;/, '');
body = body.replace(/const \[activeFeedback, setActiveFeedback\][^;]+;/, '');
body = body.replace(/const \[stancePassedChecks, setStancePassedChecks\][^;]+;/, '');
body = body.replace(/const \[currentStanceCheck, setCurrentStanceCheck\][^;]+;/, '');
body = body.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[targetReps\]\);\n/, '');

body = body.replace(/const advancePhase = useCallback\(\(newPhase\) => \{/, 'this._advancePhase = (newPhase) => {');
body = body.replace(/\}, \[\]\);\n\n  \/\/ ── Tick/, '};\n\n  tick(landmarks, w, h) {');
body = body.replace(/const tick = useCallback\(\(landmarks, w, h\) => \{/, '');

body = body.replace(/squatRef\.current/g, 'this._sq');
body = body.replace(/kneeMonitorRef\.current/g, 'this._kneeMon');
body = body.replace(/torsoMonitorRef\.current/g, 'this._torsoMon');

body = body.replace(/voice\.speakQueued/g, 'this._speakQueued');
body = body.replace(/voice\.speak/g, 'this._speak');
body = body.replace(/voice\.cancel/g, 'this._voice.cancel');
body = body.replace(/voice\.resetCooldowns/g, 'this._voice.resetCooldowns');

body = body.replace(/advancePhase\(/g, 'this._advancePhase(');
body = body.replace(/setRepCount\(([^)]+)\)/g, 'this._repCount = $1');
body = body.replace(/setActiveFeedback\(/g, 'this._activeFeedback = (');
body = body.replace(/setCurrentStanceCheck\(/g, 'this._currentStanceCheck = (');

body = body.replace(/setStancePassedChecks\(/g, 'this._setStancePassedChecks(');

body = body.replace(/\bstancePassedChecks\b/g, 'this._stancePassedChecks');
body = body.replace(/this\.this\._stancePassedChecks/g, 'this._stancePassedChecks');

body = body.replace(/\bactiveFeedback\b/g, 'this._activeFeedback');
body = body.replace(/this\.this\._activeFeedback/g, 'this._activeFeedback');

body = body.replace(/\}, \[voice, advancePhase, stancePassedChecks, activeFeedback\]\);/, '}');

body = body.replace(/const reset = useCallback\(\(\) => \{/, 'reset() {');
body = body.replace(/\}, \[voice\]\);\n\n  return \{[\s\S]*?\};\n\}/, '}');

const classHeader = `
export class SquatFlow {
  constructor({ targetReps = 0, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps;
    this._sq = new SquatRepTracker();
    this._kneeMon = new KneeAngleRepMonitor();
    this._torsoMon = new TorsoBendRepMonitor();
    this._wasInSquat = false;
    this._phase = PHASE.WAITING_FOR_PERSON;
    this._repCount = 0;
    this._activeFeedback = '';
    this._stancePassedChecks = {};
    this._currentStanceCheck = null;
    this._boundaryStableStart = -1;
    this._stancePassHoldStart = -1;
    this._confirmationStart = -1;
    this._readyStart = -1;
    this._fullBodyVoiceSent = false;
    this._stanceOkVoiceSent = false;
    this._doRepOneVoiceSent = false;
    this._doneVoiceSent = false;
    this._lastSeenRep = 0;
    CFG.squat_max_reps = targetReps;
  }

  _speak(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speak(text, opts);
  }

  _speakQueued(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speakQueued(text, opts);
  }

  _setStancePassedChecks(updater) {
    if (typeof updater === 'function') this._stancePassedChecks = updater(this._stancePassedChecks);
    else this._stancePassedChecks = updater;
  }

  _advancePhase(newPhase) {
    if (this._phase === newPhase) return;
    this._phase = newPhase;
  }

  setTargetReps(n) {
    this._targetReps = n;
    CFG.squat_max_reps = n;
  }

  toTrackerState(fr) {
    const level = fr.statusKind === 'fail' || fr.statusKind === 'warn' ? 'warn' : 'ok';
    const colors = { ok: 'rgb(34,211,166)', warn: 'rgb(245,158,11)', fail: 'rgb(239,68,68)' };
    return {
      exerciseId: 'squat',
      repCount: fr.repCount ?? this._repCount,
      phase: fr.phase === PHASE.EXERCISE_ACTIVE ? (fr.squatTracker?.inSquat ? 'down' : 'up') : fr.phase,
      progress: fr.squatTracker?.depthPct ?? 0,
      formScore: 100,
      ready: [PHASE.EXERCISE_ACTIVE, PHASE.DONE].includes(fr.phase),
      posture: fr.statusKind === 'ok' ? 'correct' : 'warning',
      cues: [{ level, text: fr.activeFeedback || fr.status || 'Tracking…' }],
      feedback: fr.activeFeedback || null,
      skeletonColor: fr.boneColor || colors[level] || colors.ok,
      drawGuideBox: fr.drawGuideBox,
      flowPhase: fr.phase,
      stanceData: fr.stanceData,
      squatTracker: fr.squatTracker,
      runAnalysis: fr.runAnalysis,
    };
  }
}
`;

fs.writeFileSync(path, header + classHeader + body);
console.log('SquatFlow converted');
