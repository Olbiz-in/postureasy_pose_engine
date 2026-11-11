import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech } from '../src/core/speechSynth.js';
import { repCountText, LR_LIVE_VOICE } from '../src/exercises/lateralRaise/config.js';

function mockEnv({ voices = [{ name: 'Test', lang: 'en-US' }] } = {}) {
  const spoken = [];
  const events = [];
  const synth = {
    speaking: false, pending: false, paused: false, cancelled: 0,
    getVoices: () => voices,
    addEventListener() {},
    cancel() { this.cancelled += 1; this.speaking = false; },
    resume() { this.paused = false; },
    speak(u) {
      this.speaking = true;
      spoken.push(u);
      if (u.text !== 'Ready') {
        events.push(`start:${u.text}`);
        u.onstart?.();
      }
    },
    finish(u) { this.speaking = false; if (u.text !== 'Ready') events.push(`end:${u.text}`); u.onend?.(); },
  };
  class Utt { constructor(text) { this.text = text; } }
  const timers = [];
  const sp = createSpeech({
    getSynth: () => synth, getUtteranceCtor: () => Utt, log: () => {},
    setTimer: (fn) => timers.push(fn),
  });
  return { sp, synth, spoken, events, flush: () => timers.splice(0).forEach((f) => f()) };
}

test('after first click, speak("One") produces start and end events', () => {
  const { sp, synth, spoken, events } = mockEnv();
  sp.unlock();
  assert.equal(sp.speak('One', { priority: 'count' }), true);
  const u = spoken.find((x) => x.text === 'One');
  assert.ok(u, 'utterance spoken');
  assert.equal(u.voice.lang, 'en-US');
  assert.equal(sp.isSpeaking(), true);
  synth.finish(u);
  assert.deepEqual(events, ['start:One', 'end:One']);
  assert.equal(sp.isSpeaking(), false);
});

test('a count interrupts a playing cue and is not spoken in the same tick as cancel', () => {
  const { sp, synth, spoken, events, flush } = mockEnv();
  sp.unlock();
  sp.speak('Lift higher', { priority: 'cue' });
  sp.speak('Two', { priority: 'count' });
  assert.equal(synth.cancelled, 1);
  assert.ok(!spoken.some((u) => u.text === 'Two'), 'waits ~50ms after cancel');
  flush();
  assert.ok(spoken.some((u) => u.text === 'Two'));
  assert.deepEqual(events, ['start:Lift higher', 'start:Two']);
});

test('a pending cue is dropped when a count arrives', () => {
  const { sp, synth, spoken } = mockEnv();
  sp.unlock();
  sp.speak('One', { priority: 'count' });
  sp.speak('Lower your arms', { priority: 'cue' }); // queued behind the count
  sp.speak('Two', { priority: 'count' });
  synth.finish(spoken.find((u) => u.text === 'One'));
  synth.finish(spoken.find((u) => u.text === 'Two'));
  assert.ok(!spoken.some((u) => u.text === 'Lower your arms'));
});

test('counts are never skipped (queued in order)', () => {
  const { sp, synth, spoken } = mockEnv();
  sp.unlock();
  sp.speak('One', { priority: 'count' });
  sp.speak('Two', { priority: 'count' });
  synth.finish(spoken.find((u) => u.text === 'One'));
  assert.ok(spoken.some((u) => u.text === 'Two'));
});

test('resumes a paused synth and reports unsupported browsers', () => {
  const env = mockEnv();
  env.synth.paused = true;
  env.sp.unlock();
  env.sp.speak('One', { priority: 'count' });
  assert.equal(env.synth.paused, false);
  const none = createSpeech({ getSynth: () => null, getUtteranceCtor: () => null, log: () => {} });
  assert.equal(none.unlock().supported, false);
  assert.match(none.getWarning(), /not supported/);
});

test('count text styles', () => {
  assert.equal(repCountText(1, 'number'), 'One');
  assert.equal(repCountText(10, 'number'), 'Ten');
  assert.equal(repCountText(3, 'rep'), 'Rep 3');
  assert.equal(LR_LIVE_VOICE.VALID_FRAMES, 2);
  assert.equal(LR_LIVE_VOICE.CUE_TEXT.lr_elbow_too_high, 'Lower your arms');
});

test('prefers an on-device Indian English voice, then falls back to other English', () => {
  const voices = [
    { name: 'Online IN', lang: 'en-IN', localService: false },
    { name: 'Local IN', lang: 'en_IN', localService: true },
    { name: 'US', lang: 'en-US', localService: true },
  ];
  const a = mockEnv({ voices });
  a.sp.configure({ lang: 'en-IN' });
  a.sp.unlock();
  a.sp.speak('One', { priority: 'count' });
  assert.equal(a.spoken.find((u) => u.text === 'One').voice.name, 'Local IN');

  const b = mockEnv({ voices: [{ name: 'US', lang: 'en-US', localService: true }] });
  b.sp.configure({ lang: 'en-IN' });
  b.sp.unlock();
  b.sp.speak('One', { priority: 'count' });
  assert.equal(b.spoken.find((u) => u.text === 'One').voice.name, 'US');
});
