import fs from 'fs';

const path = new URL('../src/exercises/pushup/PushUpFlow.js', import.meta.url);
let s = fs.readFileSync(path, 'utf8');

s = s.replace(/import \{ useRef, useState, useCallback, useEffect \} from 'react';\n/, '');
s = s.replace(/import \{ useVoiceManager \} from '\.\.\/shared\/hooks\/useVoiceManager';\n/, "import { VoiceManager } from '../../core/voiceManager.js';\n");
s = s.replace(/from '\.\/pushUpConstants'/, "from './config.js'");
s = s.replace(/from '\.\/pushUpTracker'/, "from './PushUpRepTracker.js'");
s = s.replace(/from '\.\/pushUpRepErrorPriority'/, "from './repErrorPriority.js'");
s = s.replace(/import \{ snapshotManager \} from '\.\.\/shared\/utils\/postureSnapshotManager';\n/, '');

const hookIdx = s.indexOf('export function usePushUpFlow');
const header = s.slice(0, hookIdx);
let body = s.slice(hookIdx);

body = body.replace(/export function usePushUpFlow\(\{ targetReps = 0 \}\) \{[\s\S]*?const voice\s+=\s+useVoiceManager\(\);\n/, '');
body = body.replace(/const repRef\s+=\s+useRef\(new PushUpRepTracker\(\)\);\n/, '');
body = body.replace(/const repAccumRef\s+=\s+useRef\(createEmptyRepAccumulator\(\)\);\n/, '');

const refs = [
  'phaseRef', 'readyStartRef', 'readyVoiceSentRef', 'doneVoiceSentRef', 'targetRepsRef',
];
for (const r of refs) {
  body = body.replace(new RegExp(`${r}\\.current`, 'g'), `this._${r.replace('Ref', '')}`);
}

body = body.replace(/const \[phase, setPhase\][^;]+;/, '');
body = body.replace(/const \[repCount, setRepCount\][^;]+;/, '');
body = body.replace(/const \[activeFeedback, setActiveFeedback\][^;]+;/, '');
body = body.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[targetReps\]\);\n/, '');

body = body.replace(/const advancePhase = useCallback\(\(newPhase\) => \{/, 'this._advancePhase = (newPhase) => {');
body = body.replace(/\}, \[\]\);\n\n  \/\/ ── Tick/, '};\n\n  tick(landmarks) {');
body = body.replace(/const tick = useCallback\(\(landmarks\) => \{/, '');

body = body.replace(/repRef\.current/g, 'this._rep');
body = body.replace(/repAccumRef\.current/g, 'this._repAccum');

body = body.replace(/voice\.speakQueued/g, 'this._speakQueued');
body = body.replace(/voice\.speak/g, 'this._speak');
body = body.replace(/voice\.cancel/g, 'this._voice.cancel');
body = body.replace(/voice\.resetCooldowns/g, 'this._voice.resetCooldowns');

body = body.replace(/advancePhase\(/g, 'this._advancePhase(');
body = body.replace(/setRepCount\(([^)]+)\)/g, 'this._repCount = $1');
body = body.replace(/setActiveFeedback\(/g, 'this._activeFeedback = (');

body = body.replace(/repAccumRef\.current = createEmptyRepAccumulator\(\)/g, 'this._repAccum = createEmptyRepAccumulator()');

body = body.replace(/\bactiveFeedback\b/g, 'this._activeFeedback');
body = body.replace(/this\.this\._activeFeedback/g, 'this._activeFeedback');

body = body.replace(/snapshotManager\.queueCapture\([^)]+\);\n/g, '');

body = body.replace(/\}, \[voice, advancePhase, activeFeedback\]\);/, '}');

body = body.replace(/const reset = useCallback\(\(\) => \{/, 'reset() {');
body = body.replace(/\}, \[voice\]\);\n\n  return \{[\s\S]*?\};\n\}/, '}');

const classHeader = `
export class PushUpFlow {
  constructor({ targetReps = 0, voice = true } = {}) {
    this._voiceEnabled = voice !== false;
    this._voice = new VoiceManager();
    this._targetReps = targetReps;
    this._rep = new PushUpRepTracker();
    this._repAccum = createEmptyRepAccumulator();
    this._phase = PUSHUP_PHASE.WAITING_FOR_PERSON;
    this._repCount = 0;
    this._activeFeedback = '';
    this._readyStart = -1;
    this._readyVoiceSent = false;
    this._doneVoiceSent = false;
    PUSHUP_CFG.pushup_max_reps = targetReps;
  }

  _speak(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speak(text, opts);
  }

  _speakQueued(text, opts) {
    if (!this._voiceEnabled) return false;
    return this._voice.speakQueued(text, opts);
  }

  _advancePhase(newPhase) {
    if (this._phase === newPhase) return;
    this._phase = newPhase;
  }

  setTargetReps(n) {
    this._targetReps = n;
    PUSHUP_CFG.pushup_max_reps = n;
  }

  toTrackerState(fr) {
    const level = fr.statusKind === 'fail' || fr.statusKind === 'warn' ? 'warn' : 'ok';
    const colors = { ok: 'rgb(34,211,166)', warn: 'rgb(245,158,11)', fail: 'rgb(239,68,68)' };
    return {
      exerciseId: 'pushup',
      repCount: fr.repCount ?? this._repCount,
      phase: fr.pushupState === 'DOWN' ? 'down' : fr.pushupState === 'UP' ? 'up' : fr.phase,
      progress: fr.elbowAngle ? Math.max(0, Math.min(1, (180 - fr.elbowAngle) / 100)) : 0,
      formScore: 100,
      ready: [PUSHUP_PHASE.EXERCISE_ACTIVE, PUSHUP_PHASE.DONE].includes(fr.phase),
      posture: fr.postureResult?.primaryColorKey === 'red' ? 'incorrect' : 'correct',
      cues: [{ level, text: fr.activeFeedback || fr.status || 'Tracking…' }],
      feedback: fr.activeFeedback || null,
      skeletonColor: fr.boneColor || colors[level] || colors.ok,
      elbowAngle: fr.elbowAngle,
      flowPhase: fr.phase,
      pushupTracker: fr.pushupTracker,
      postureResult: fr.postureResult,
    };
  }
}
`;

fs.writeFileSync(path, header + classHeader + body);
console.log('PushUpFlow converted');
